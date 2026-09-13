// Scenario: game-service restarts in the middle of a game ("let it crash").
// The game actors live in memory, but their state is persisted in game-db. On startup the
// supervisor recovers every active game, so the players reconnect and finish the game.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
    FOOLS_MATE,
    closeAll,
    connectSocket,
    dockerCompose,
    findHistory,
    gameUrl,
    joinLobby,
    onceEvent,
    playMove,
    registerUser,
    startTwoPlayerGame,
    waitFor,
    waitForHealthy
} from "./helpers.mjs";

after(closeAll);

describe("supervision: active games survive a game-service restart", () => {
    it("players continue a game after game-service was restarted", async () => {
        const white = await registerUser();
        const black = await registerUser();

        const game = await startTwoPlayerGame(white, black);
        await playMove(game.whiteSocket, game.blackSocket, FOOLS_MATE.white[0]);
        await playMove(game.blackSocket, game.whiteSocket, FOOLS_MATE.black[0]);
        game.whiteSocket.disconnect();
        game.blackSocket.disconnect();

        dockerCompose("restart", "game-service");
        await waitForHealthy("game");

        // the supervisor recovered the game from the database
        const recovered = await (await fetch(`${gameUrl}/v1/games/${game.code}`)).json();
        assert.match(recovered.pgn, /1\. f3 e5$/);

        // both players reconnect and finish the game
        const whiteSocket = await connectSocket(white.cookie);
        const blackSocket = await connectSocket(black.cookie);
        try {
            await joinLobby(whiteSocket, game.code);
            await joinLobby(blackSocket, game.code);

            await playMove(whiteSocket, blackSocket, FOOLS_MATE.white[1]);
            const gameOver = onceEvent(whiteSocket, "gameOver");
            blackSocket.emit("sendMove", FOOLS_MATE.black[1]);
            assert.equal((await gameOver).winnerSide, "black");
        } finally {
            whiteSocket.disconnect();
            blackSocket.disconnect();
        }

        const history = await waitFor(() => findHistory(game.code), { label: "game_history row" });
        assert.equal(history.end_reason, "checkmate");
    });
});
