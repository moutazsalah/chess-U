import type { Game, User } from "@chessu/types";
import { Chess } from "chess.js";

/*
 * Actor model: every active game is one GameActor.
 *
 * - The actor owns its game state privately; nothing outside mutates it.
 * - Other code talks to the actor only by sending messages (`send`).
 * - Messages wait in the actor's mailbox and are processed strictly one at a time,
 *   so two moves arriving at the same moment can never interleave or corrupt the state,
 *   even though each message awaits I/O (database write, RabbitMQ publish).
 * - Different games are different actors, so they run independently of each other.
 *
 * "Let it crash": the actor does not try to recover from unexpected failures (e.g. the database
 * write fails). It stops, rejects the messages in its mailbox and reports the failure to its
 * supervisor (see supervisor.ts), which restarts it from the last persisted state.
 * Expected rule violations (illegal move, not your turn, ...) are GameRuleErrors: they only
 * reject that one message and the actor keeps running.
 */

// a request that breaks the rules of the game; not a failure of the actor
export class GameRuleError extends Error {}

export type Move = { from: string; to: string; promotion?: string };

export type GameOver = {
    reason: Game["endReason"];
    winnerName?: string | null;
    winnerSide?: "white" | "black";
};

export type GameMessage =
    | { type: "UserJoined"; user: User }
    | { type: "UserLeft"; user: User }
    | { type: "JoinAsPlayer"; user: User }
    | { type: "SendMove"; user: User; move: Move }
    | { type: "ClaimAbandoned"; user: User; claim: "win" | "draw" };

export type GameReplies = {
    UserJoined: Game;
    UserLeft: Game;
    JoinAsPlayer: { game: Game; side: "white" | "black" | null };
    SendMove: { game: Game; move: Move; gameOver: GameOver | null };
    ClaimAbandoned: GameOver;
};

// side effects are injected so the actor can be unit-tested without a database or broker
export interface GameActorDeps {
    persist: (game: Game, active: boolean) => Promise<void>;
    publish: (type: string, payload: unknown) => Promise<void>;
    // the game ended normally
    onStopped: (code: string) => void;
    // unexpected failure: the supervisor decides what to do
    onCrashed: (code: string, error: unknown) => void;
}

type Envelope = {
    message: GameMessage;
    resolve: (reply: any) => void;
    reject: (error: unknown) => void;
};

export class GameActor {
    private readonly mailbox: Envelope[] = [];
    private processing = false;
    private status: "running" | "stopped" | "crashed" = "running";

    constructor(
        private readonly game: Game,
        private readonly deps: GameActorDeps
    ) {}

    get code() {
        return this.game.code as string;
    }

    // read-only view for HTTP queries and socket broadcasts
    get snapshot(): Readonly<Game> {
        return this.game;
    }

    send<M extends GameMessage>(message: M): Promise<GameReplies[M["type"]]> {
        return new Promise((resolve, reject) => {
            this.mailbox.push({ message, resolve, reject });
            void this.processMailbox();
        });
    }

    private async processMailbox() {
        if (this.processing) {
            return; // the running loop will pick up the new message
        }
        this.processing = true;
        while (this.mailbox.length) {
            const { message, resolve, reject } = this.mailbox.shift() as Envelope;
            if (this.status !== "running") {
                reject(
                    this.status === "stopped"
                        ? new GameRuleError("Game already finished")
                        : new Error("Game is restarting, try again")
                );
                continue;
            }
            try {
                resolve(await this.receive(message));
            } catch (error) {
                reject(error);
                if (!(error instanceof GameRuleError)) {
                    this.crash(error);
                }
            }
        }
        this.processing = false;
    }

    private crash(error: unknown) {
        this.status = "crashed";
        // the in-memory state may be half-updated, so it is discarded together with the actor
        this.deps.onCrashed(this.code, error);
    }

    private receive(message: GameMessage) {
        switch (message.type) {
            case "UserJoined":
                return this.onUserJoined(message.user);
            case "UserLeft":
                return this.onUserLeft(message.user);
            case "JoinAsPlayer":
                return this.onJoinAsPlayer(message.user);
            case "SendMove":
                return this.onSendMove(message.user, message.move);
            case "ClaimAbandoned":
                return this.onClaimAbandoned(message.user, message.claim);
        }
    }

    private stop() {
        this.status = "stopped";
        this.deps.onStopped(this.code);
    }

    private async onUserJoined(user: User) {
        const { host, white, black } = this.game;

        if (host && host.id === user.id) {
            host.connected = true;
            host.name = user.name;
        }

        if (white && white.id === user.id) {
            white.connected = true;
            white.disconnectedOn = undefined;
            white.name = user.name;
        } else if (black && black.id === user.id) {
            black.connected = true;
            black.disconnectedOn = undefined;
            black.name = user.name;
        } else {
            this.game.observers ??= [];
            if (!this.game.observers.some((observer) => observer.id === user.id)) {
                this.game.observers.push({ id: user.id, name: user.name });
            }
        }

        await this.deps.persist(this.game, true);
        return this.game;
    }

    private async onUserLeft(user: User) {
        const { white, black, observers } = this.game;
        const observerIndex = observers?.findIndex((entry) => entry.id === user.id) ?? -1;
        if (observerIndex >= 0) {
            observers?.splice(observerIndex, 1);
        }

        if (white && white.id === user.id) {
            white.connected = false;
            white.disconnectedOn = Date.now();
        } else if (black && black.id === user.id) {
            black.connected = false;
            black.disconnectedOn = Date.now();
        }

        await this.deps.persist(this.game, true);
        return this.game;
    }

    private async onJoinAsPlayer(user: User) {
        const player: User = { id: user.id, name: user.name, connected: true };
        let side: "white" | "black" | null = null;

        if (!this.game.white) {
            this.game.white = player;
            side = "white";
        } else if (!this.game.black) {
            this.game.black = player;
            side = "black";
        }

        const observerIndex = this.game.observers?.findIndex((entry) => entry.id === user.id) ?? -1;
        if (observerIndex >= 0) {
            this.game.observers?.splice(observerIndex, 1);
        }

        if (side && !this.game.startedAt) {
            this.game.startedAt = Date.now();
        }

        await this.deps.persist(this.game, true);
        await this.deps.publish("PlayerJoinedGame", { code: this.code, player, side });

        return { game: this.game, side };
    }

    private async onSendMove(user: User, move: Move) {
        const game = this.game;
        if (game.endReason || game.winner) {
            throw new GameRuleError("Game already finished");
        }

        const chess = new Chess();
        if (game.pgn) {
            chess.loadPgn(game.pgn);
        }

        const previousTurn = chess.turn();
        if (
            (previousTurn === "w" && user.id !== game.white?.id) ||
            (previousTurn === "b" && user.id !== game.black?.id)
        ) {
            throw new GameRuleError("Not your turn");
        }

        // chess.js throws on illegal moves in newer versions and returns null in older ones
        let appliedMove: unknown = null;
        try {
            appliedMove = chess.move(move);
        } catch {
            // handled below
        }
        if (!appliedMove) {
            throw new GameRuleError("Invalid move");
        }

        game.pgn = chess.pgn();
        await this.deps.persist(game, true);
        await this.deps.publish("MovePlayed", {
            code: this.code,
            move,
            pgn: game.pgn,
            player: { id: user.id, name: user.name }
        });

        if (!chess.isGameOver()) {
            return { game, move, gameOver: null };
        }

        let reason: Game["endReason"] = "draw";
        if (chess.isCheckmate()) reason = "checkmate";
        else if (chess.isStalemate()) reason = "stalemate";
        else if (chess.isThreefoldRepetition()) reason = "repetition";
        else if (chess.isInsufficientMaterial()) reason = "insufficient";

        const winnerSide =
            reason === "checkmate" ? (previousTurn === "w" ? "white" : "black") : undefined;
        const winnerName = winnerSide ? game[winnerSide]?.name : undefined;

        await this.finish(reason, winnerSide ?? "draw", winnerName);
        return { game, move, gameOver: { reason, winnerName, winnerSide } };
    }

    private async onClaimAbandoned(user: User, claim: "win" | "draw") {
        const { white, black } = this.game;
        if (!this.game.pgn || !white || !black || (white.id !== user.id && black.id !== user.id)) {
            throw new GameRuleError("Invalid abandoned claim");
        }

        const isWhitePlayer = white.id === user.id;
        const opponent = isWhitePlayer ? black : white;
        if (opponent.connected || Date.now() - (opponent.disconnectedOn as number) < 50000) {
            throw new GameRuleError("Opponent is still connected");
        }

        const winner = claim === "draw" ? "draw" : isWhitePlayer ? "white" : "black";
        await this.finish("abandoned", winner, user.name);

        return {
            reason: this.game.endReason,
            winnerName: user.name,
            winnerSide: winner === "draw" ? undefined : winner
        };
    }

    private async finish(
        reason: Game["endReason"],
        winner: "white" | "black" | "draw",
        winnerName?: string | null
    ) {
        const game = this.game;
        game.endReason = reason;
        game.winner = winner;
        game.endedAt = Date.now();

        await this.deps.persist(game, false);
        // the fact the read side (stats-history-service) builds its projections from
        await this.deps.publish("GameFinished", {
            code: game.code,
            white: game.white,
            black: game.black,
            winner: game.winner,
            winnerName,
            endReason: game.endReason,
            pgn: game.pgn,
            startedAt: game.startedAt,
            endedAt: game.endedAt
        });

        this.stop();
    }
}
