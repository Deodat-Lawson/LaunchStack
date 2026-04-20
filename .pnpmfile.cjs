// Skip heavy optional peer deps that are no longer used directly.
// @huggingface/transformers (and its transitive onnxruntime-node/sharp) was
// moved to the ocr-router sidecar — prevent @langchain/community from pulling
// it into the main app's node_modules.
function readPackage(pkg) {
  if (pkg.name === "@langchain/community") {
    delete pkg.peerDependencies?.["@huggingface/transformers"];
    delete pkg.peerDependenciesMeta?.["@huggingface/transformers"];
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
