import { createEventPublisher } from "@chessu/shared";

let publish: Awaited<ReturnType<typeof createEventPublisher>> | null = null;

export const initPublisher = async () => {
    publish = await createEventPublisher("game-service");
};

export const publishEvent = async (type: string, payload: unknown) => {
    if (!publish) {
        throw new Error("game-service publisher not initialized");
    }
    await publish(type, payload);
};
