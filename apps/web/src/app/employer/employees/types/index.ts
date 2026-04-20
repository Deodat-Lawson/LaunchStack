
export interface Employee {
    id: string;
    name: string;
    email: string;
    role: string; // "employee" or "employer"
    status: "verified" | "pending";
}
