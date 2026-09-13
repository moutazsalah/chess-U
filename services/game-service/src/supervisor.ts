import type { Game } from "@chessu/types";

import { GameActor } from "./actor.js";

/*
 * Supervisor of the game actors ("let it crash" + supervision from the actor model).
 *
 * - It spawns one GameActor per active game and keeps the registry of running actors.
 * - When an actor crashes, the supervisor restarts only that actor (one-for-one strategy)
 *   from the last state persisted in the database; the other games are not affected.
 * - If an actor keeps crashing (more than `maxRestarts` within `withinMs`), the supervisor
 *   gives up on it instead of restarting it forever.
 * - When game-service starts, the supervisor recovers the games that were still active.
 */

// persistence and messaging are injected so the supervisor can be unit-tested
export interface GameStore {
    persist: (game: Game, active: boolean) => Promise<void>;
    publish: (type: string, payload: unknown) => Promise<void>;
    load: (code: string) => Promise<Game | undefined>;
    loadActive: () => Promise<Game[]>;
}

export interface SupervisorOptions {
    maxRestarts: number;
    withinMs: number;
    restartDelayMs: number;
}

const defaultOptions: SupervisorOptions = { maxRestarts: 3, withinMs: 60_000, restartDelayMs: 500 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GameSupervisor {
    private readonly actors = new Map<string, GameActor>();
    private readonly restarting = new Set<string>();
    private readonly restartHistory = new Map<string, number[]>();
    private readonly options: SupervisorOptions;

    constructor(
        private readonly store: GameStore,
        options: Partial<SupervisorOptions> = {}
    ) {
        this.options = { ...defaultOptions, ...options };
    }

    spawn(game: Game) {
        const actor = new GameActor(game, {
            persist: this.store.persist,
            publish: this.store.publish,
            onStopped: (code) => this.actors.delete(code),
            onCrashed: (code, error) => void this.restart(code, error)
        });
        this.actors.set(actor.code, actor);
        return actor;
    }

    get(code: string) {
        return this.actors.get(code);
    }

    isRestarting(code: string) {
        return this.restarting.has(code);
    }

    list() {
        return Array.from(this.actors.values());
    }

    // after a service restart nobody is connected any more; players get the usual reconnect window
    async recoverActiveGames() {
        const games = await this.store.loadActive();
        for (const game of games) {
            const now = Date.now();
            for (const player of [game.white, game.black]) {
                if (player) {
                    player.connected = false;
                    player.disconnectedOn = now;
                }
            }
            if (game.host) {
                game.host.connected = false;
            }
            game.observers = [];
            this.spawn(game);
        }
        return games.length;
    }

    private async restart(code: string, error: unknown) {
        this.actors.delete(code);
        console.error(`game actor ${code} crashed:`, error);

        const now = Date.now();
        const recent = (this.restartHistory.get(code) ?? []).filter(
            (time) => now - time < this.options.withinMs
        );
        if (recent.length >= this.options.maxRestarts) {
            console.error(`game actor ${code} crashed too often, not restarting it`);
            this.restartHistory.delete(code);
            return;
        }
        this.restartHistory.set(code, [...recent, now]);

        this.restarting.add(code);
        try {
            await sleep(this.options.restartDelayMs);
            const game = await this.store.load(code);
            if (game && !game.winner) {
                this.spawn(game);
                console.log(`game actor ${code} restarted from its persisted state`);
            }
        } catch (loadError) {
            // the state could not be loaded (database still down?): count it as another crash
            this.restarting.delete(code);
            await this.restart(code, loadError);
            return;
        }
        this.restarting.delete(code);
    }
}
