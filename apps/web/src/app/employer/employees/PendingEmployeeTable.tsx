"use client";

import React from "react";
import { CheckCircle, Trash2 } from "lucide-react";
import styles from "~/styles/Employer/EmployeeManagement.module.css";
import { type Employee } from "./types";

interface PendingEmployeeTableProps {
    employees: Employee[];
    onApprove: (employeeId: string) => void;
    onRemove: (employeeId: string) => void;
}

const PendingEmployeeTable: React.FC<PendingEmployeeTableProps> = ({
                                                                       employees,
                                                                       onApprove,
                                                                       onRemove,
                                                                   }) => {
    if (employees.length === 0) {
        return <p>No pending employees.</p>;
    }

    return (
        <table className={styles.employeeTable}>
            <thead>
            <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Action</th>
            </tr>
            </thead>
            <tbody>
            {employees.map((emp) => (
                <tr key={emp.id}>
                    <td>{emp.name}</td>
                    <td>{emp.email}</td>
                    <td>{emp.role === "employer" ? "admin" : emp.role}</td>
                    <td>
                        <button
                            className={styles.approveButton}
                            onClick={() => onApprove(emp.id)}
                        >
                            <CheckCircle size={16} />
                            Approve
                        </button>
                        <button
                            className={styles.removeButton}
                            onClick={() => onRemove(emp.id)}
                        >
                            <Trash2 size={16} />
                            Remove
                        </button>
                    </td>
                </tr>
            ))}
            </tbody>
        </table>
    );
};

export default PendingEmployeeTable;
