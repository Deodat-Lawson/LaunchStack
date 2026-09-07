// Skip heavy optional peer deps that are no longer used directly.
// @huggingface/transformers (and its transitive onnxruntime-node/sharp) was
// moved to the ocr-router sidecar — prevent @langchain/community from pulling
// it into the main app's node_modules.
function readPackage(pkg) {
  if (pkg.name === "@langchain/community") {
    delete pkg.peerDependencies?.["@huggingface/transformers"];
    delete pkg.peerDependenciesMeta?.["@huggingface/transformers"];
  }
  // better-auth hard-depends on kysely (its default DB layer; we use its
  // drizzle adapter instead). drizzle-orm optionally peers on kysely, so
  // kysely's presence forked drizzle-orm into two peer-hashed instances
  // whose types don't unify. Nothing here uses drizzle's kysely bridge —
  // drop the peer so the workspace keeps a single drizzle-orm.
  if (pkg.name === "drizzle-orm") {
    delete pkg.peerDependencies?.["kysely"];
    delete pkg.peerDependenciesMeta?.["kysely"];
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
