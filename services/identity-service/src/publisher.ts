import { createEventPublisher } from "@chessu/shared";

let publish: Awaited<ReturnType<typeof createEventPublisher>> | null = null;

export const initPublisher = async () => {
    publish = await createEventPublisher("identity-service");
};

export const publishEvent = async (type: string, payload: unknown) => {
    if (!publish) {
        throw new Error("identity-service publisher not initialized");
    }
    await publish(type, payload);
};
