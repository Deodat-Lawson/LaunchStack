/**
 * Document Q&A model access. Re-exported from the shared lib so one place
 * controls how routes resolve.
 */
export {
  resolveConfiguredChatModel,
  resolveConfiguredChatRoute,
  selectChatRoute,
  getEmbeddings,
} from "~/lib/models";
