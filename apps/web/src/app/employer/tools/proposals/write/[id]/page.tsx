import { ApplicationScreen } from "../../_screens/ApplicationScreen";

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <ApplicationScreen id={id} />;
}
