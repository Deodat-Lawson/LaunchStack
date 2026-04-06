"use client";
import React, { useRef, useEffect } from "react";
import styles from "~/styles/Employer/ProfileDropdown.module.css";
import { UserButton } from '~/components/UserButton';


const ProfileDropdown: React.FC = () => {
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [isMounted, setIsMounted] = React.useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node)
            ) {
                return;
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    return (
        <div className={styles.dropdownContainer} ref={dropdownRef}>
            {isMounted ? <UserButton /> : <div aria-hidden="true" />}
        </div>
    );
};

export default ProfileDropdown;