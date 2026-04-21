/**
 * Document Q&A chat model factory.
 * Re-exports from shared lib so one place controls model config.
 */
export {
  getChatModel,
  getEmbeddings,
  type AIModelType,
} from "~/lib/models";
