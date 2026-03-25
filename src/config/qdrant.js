import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "./env.js";

export const qdrant = new QdrantClient({ url: config.qdrantUrl });
