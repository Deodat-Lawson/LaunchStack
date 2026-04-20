"use client";

import React from "react";
import { Trash2 } from "lucide-react";
import styles from "~/styles/Employer/EmployeeManagement.module.css";
import { type Employee } from "./types";

interface EmployeeTableProps {
    employees: Employee[];
    onRemove: (employeeId: string) => void;
    currentUserRole: "owner" | "employer" | "employee";
}

const EmployeeTable: React.FC<EmployeeTableProps> = ({
                                                         employees,
                                                         onRemove,
                                                         currentUserRole,
                                                     }) => {
    if (employees.length === 0) {
        return <p>No approved employees yet.</p>;
    }

    // A small helper function to decide if the trash button should be shown
    const shouldShowTrash = (employeeRole: string) => {
        if (currentUserRole === "owner") {
            // owner can remove both employer and employee roles
            return employeeRole === "employer" || employeeRole === "employee";
        }
        if (currentUserRole === "employer") {
            // employer can remove only employee role
            return employeeRole === "employee";
        }
        return false;
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
            {employees.map((emp) => (
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