import { Suspense } from "react";

import { CompaniesScreen } from "../_screens/CompaniesScreen";

export default function CompaniesPage() {
    return (
        <Suspense fallback={null}>
            <CompaniesScreen />
        </Suspense>
    );
}
