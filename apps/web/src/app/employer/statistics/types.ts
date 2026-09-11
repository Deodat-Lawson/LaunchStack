export interface TrendDataPoint {
    date: string;
    count: number;
}

export interface EmployeeInfo {
    id: number;
    name: string;
    email: string;
    role: string;
    status: string;
    lastActiveAt: string | null;
    createdAt: string;
    queryCount: number;
}

export interface DocumentStat {
    id: number;
    title: string;
    category: string;
    views: number;
    lastViewedAt: string | null;
    createdAt: string;
}

export interface DashboardData {
    totalEmployees: number;
    totalDocuments: number;
    employees: EmployeeInfo[];
    employeeTrend: TrendDataPoint[];
    documentViewsTrend: TrendDataPoint[];
    documentStats: DocumentStat[];
}

export interface Viewer {
    name: string;
    email: string;
    viewedAt: string;
    role: string;
}

export interface DocumentDetails {
    id: number;
    title: string;
    category: string;
    createdAt: string;
    totalViews: number;
    uniqueViewers: number;
    recentViewers: Viewer[];
    viewsTrend: TrendDataPoint[];
}
