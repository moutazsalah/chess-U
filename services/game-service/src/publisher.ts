import type { DomainEvent } from "@chessu/shared";
import { connectRabbitMq } from "@chessu/shared";

let publishImpl: ((event: DomainEvent) => Promise<void>) | null = null;

export const initPublisher = async () => {
    try {
        const { channel } = await connectRabbitMq();
        publishImpl = async (event) => {
            channel.publish(
                "domain-events",
                event.type,
                Buffer.from(JSON.stringify(event)),
                { persistent: true, contentType: "application/json" }
            );
        };
    } catch (error) {
        console.warn("game-service publisher unavailable", error);
        publishImpl = null;
    }
};

export const publishDomainEvent = async (event: DomainEvent) => {
    if (!publishImpl) {
        console.log("game-event", JSON.stringify(event));
        return;
    }
    await publishImpl(event);
};
