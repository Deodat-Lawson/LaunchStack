"use client";

import React from "react";
import { Trash2 } from "lucide-react";
import styles from "~/styles/Employer/EmployeeManagement.module.css";
import { type Employee } from "./types";
import { type ManagementRole } from "~/lib/membership-roles";

interface EmployeeTableProps {
    employees: Employee[];
    onRemove: (employeeId: string) => void;
    currentUserRole: ManagementRole;
}

const EmployeeTable: React.FC<EmployeeTableProps> = ({ employees, onRemove, currentUserRole }) => {
    if (employees.length === 0) {
        return <p>No approved employees yet.</p>;
    }

    // Roster rows still carry the legacy `users.role` vocabulary
    // (`employer` / `employee`); only the caller's role is a membership role.
    const shouldShowTrash = (employeeRole: string) => {
        if (currentUserRole === "owner") {
            return employeeRole === "employer" || employeeRole === "employee";
        }
        return employeeRole === "employee";
    };

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
                {employees.map(emp => (
                    <tr key={emp.id}>
                        <td>{emp.name}</td>
                        <td>{emp.email}</td>
                        {/* If role is "employer", display "admin" instead */}
                        <td>{emp.role === "employer" ? "admin" : emp.role}</td>
                        <td>
                            {shouldShowTrash(emp.role) && (
                                <button
                                    className={styles.removeButton}
                                    onClick={() => onRemove(emp.id)}
                                >
                                    <Trash2 size={16} />
                                    Remove
                                </button>
                            )}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
};

export default EmployeeTable;
