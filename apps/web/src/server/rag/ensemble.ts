/**
 * The app's composition seam for @launchstack/retrieval's ensemble.
 *
 * The package reads no env: this module translates the deployment's flags
 * into ensemble config exactly once, at module load, and registers the
 * app-owned notes leg (notes live in product schema, so the retriever stays
 * in apps/web and joins the ensemble by injection). Route handlers import
 * the search functions from here, not from the package, so retrieval can
 * never run before this configuration has happened.
 */

import { env } from "~/env";
import {
    configureEnsemble,
    documentEnsembleSearch,
    companyEnsembleSearch,
    multiDocEnsembleSearch,
    createDocumentEnsembleRetriever,
    createCompanyEnsembleRetriever,
    createMultiDocEnsembleRetriever,
    createOpenAIEmbeddings,
    createEmbeddingsForIndex,
    type NotesLegProvider,
} from "@launchstack/retrieval/algorithms/ensemble";
import {
    createDocumentNotesRetriever,
    createCompanyNotesRetriever,
    createMultiDocNotesRetriever,
} from "~/server/notes/notes-retriever";

const notesLegs: NotesLegProvider = {
    createDocumentLeg: (documentId, embeddings, topK) =>
        createDocumentNotesRetriever(documentId, embeddings, topK),
    createCompanyLeg: (companyId, embeddings, topK, scope) =>
        createCompanyNotesRetriever(companyId, embeddings, topK, scope),
    createMultiDocLeg: (documentIds, embeddings, topK) =>
        createMultiDocNotesRetriever(documentIds, embeddings, topK),
};

configureEnsemble({
    graphRetrieval: env.server.ENABLE_GRAPH_RETRIEVER === true,
    notesLegs: env.server.ENABLE_NOTES_RETRIEVER === true ? notesLegs : null,
});

export {
    documentEnsembleSearch,
    companyEnsembleSearch,
    multiDocEnsembleSearch,
    createDocumentEnsembleRetriever,
    createCompanyEnsembleRetriever,
    createMultiDocEnsembleRetriever,
    createOpenAIEmbeddings,
    createEmbeddingsForIndex,
};
