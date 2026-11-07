"use client";

/**
 * The claim gate's words and dialog, shared by the generator's Publish and
 * Compose: what each verdict says, and "Post anyway?" for a post whose claims
 * the company's documents don't back.
 */
import { useTranslations } from "next-intl";

import { ConfirmDialog } from "~/components/ui/confirm-dialog";

import type { ClaimGateClaimUI, ClaimSourceUI, ClaimSupportUI } from "./shared";

/** The 409 body a publish route answers with when claims need a person to look. */
export function isClaimGateBody(
    body: unknown
): body is { code: "unsupported_claims"; unavailable: boolean; claims: ClaimGateClaimUI[] } {
    return (
        typeof body === "object" &&
        body !== null &&
        "code" in body &&
        body.code === "unsupported_claims" &&
        "claims" in body &&
        Array.isArray(body.claims)
    );
}

/**
 * How each verdict looks: a coloured rule on a neutral row (only "supported"
 * is green, nothing shows a score). Filled tiles in three colours made a
 * list of five claims the loudest thing on the screen.
 */
export const SUPPORT_TONE: Record<ClaimSupportUI, string> = {
    supported: "border-l-success",
    contradicted: "border-l-danger",
    unsupported: "border-l-warn",
    unchecked: "border-l-warn",
};

export function claimVerdict(
    t: ReturnType<typeof useTranslations<"growth.marketingPipeline.claims">>,
    claim: Pick<ClaimSourceUI, "support"> & { sourceDoc: string | null }
): string {
    const doc = claim.sourceDoc ?? "";
    switch (claim.support) {
        case "supported":
            return t("supported", { doc });
        case "contradicted":
            return t("contradicted", { doc });
        case "unsupported":
            return t("unsupported");
        case "unchecked":
            return t("unchecked");
    }
}

/**
 * "Post anyway?" for a post whose claims the documents don't back. The
 * server asks the same question (a 409) for the final text, so this cannot
 * be skipped by editing after generation.
 */
export function ClaimGateDialog({
    gate,
    onConfirm,
    onCancel,
}: {
    gate: { unavailable: boolean; claims: ClaimGateClaimUI[] } | null;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const t = useTranslations("growth.marketingPipeline.claims");
    return (
        <ConfirmDialog
            open={gate !== null}
            onOpenChange={open => {
                if (!open) onCancel();
            }}
            title={
                gate?.unavailable
                    ? t("unavailable")
                    : t("gateTitle", { count: gate?.claims.length ?? 0 })
            }
            description={
                gate?.unavailable
                    ? t("gateBodyUnavailable")
                    : t("gateBody", {
                          claims: (gate?.claims ?? [])
                              .map(c => `“${c.claim}” (${claimVerdict(t, c)})`)
                              .join("; "),
                      })
            }
            confirmLabel={t("gateConfirm")}
            cancelLabel={t("gateCancel")}
            destructive={false}
            onConfirm={onConfirm}
        />
    );
}
