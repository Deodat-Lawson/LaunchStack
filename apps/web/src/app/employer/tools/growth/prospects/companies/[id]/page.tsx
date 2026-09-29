import { CompanyScreen } from "../../_screens/CompanyScreen";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <CompanyScreen id={id} />;
}
