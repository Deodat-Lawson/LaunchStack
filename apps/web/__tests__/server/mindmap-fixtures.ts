import {
    createDoc,
    createEdge,
    createNode,
    createPage,
} from "~/app/employer/documents/_mindmap/model/factory";
import type { DiagramNode, MindmapDoc } from "~/app/employer/documents/_mindmap/model/types";

/**
 * Mind-shaped documents from nested label trees, for the tests that look at
 * what a published map becomes. Built with the same factories the editor
 * uses, so the outline renderer sees real nodes and edges, not a stand-in.
 */

export interface Tree {
    [label: string]: Tree | null;
}

export function treeDoc(title: string, tree: Tree): MindmapDoc {
    const page = createPage("Page 1");
    const nodes: DiagramNode[] = [];
    const edges = page.edges;
    let y = 0;
    const add = (label: string, depth: number): DiagramNode => {
        const node = createNode({
            shape: depth === 0 ? "mind-root" : "mind-branch",
            x: depth * 260,
            y: (y += 70),
            w: 200,
            h: 56,
            text: label,
        });
        nodes.push(node);
        return node;
    };
    const walk = (label: string, children: Tree | null, depth: number, parent?: DiagramNode) => {
        const node = add(label, depth);
        if (parent) {
            edges.push(
                createEdge({
                    from: { nodeId: parent.id, port: "e" },
                    to: { nodeId: node.id, port: "w" },
                })
            );
        }
        for (const [child, grandchildren] of Object.entries(children ?? {})) {
            walk(child, grandchildren, depth + 1, node);
        }
    };
    for (const [root, children] of Object.entries(tree)) walk(root, children, 0);
    return createDoc(title, [{ ...page, nodes, edges }]);
}

export const LAUNCH_PLAN: Tree = {
    "Q3 launch plan": {
        Infrastructure: {
            "Postgres 16 with read replicas": null,
            "Redis for session cache": null,
            "Blue-green deploys on Kubernetes": null,
        },
        Billing: {
            "Stripe subscriptions": null,
            "Usage metering per workspace": null,
            "Invoice PDFs by email": null,
        },
        "Go-to-market": {
            "Product Hunt launch on Sept 24": null,
            "Founder webinar series": null,
            "Design-partner case studies": null,
        },
        Risks: {
            "SOC 2 audit slips": null,
            "Hiring a second SRE": null,
        },
    },
};
