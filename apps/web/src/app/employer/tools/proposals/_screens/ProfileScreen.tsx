"use client";

import { CompanyProfileView } from "~/components/company-profile/CompanyProfileView";

/**
 * What the sources can prove about the organisation, fact by fact, each
 * with its evidence. It is the same company profile Settings › Company
 * shows — one builder, one store — drawn as a full tool screen here.
 */
export function ProfileScreen() {
    return <CompanyProfileView variant="proposals" />;
}
