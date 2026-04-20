"use client";

import React, { type FC } from "react";
import styles from "~/styles/Employer/Settings.module.css";

interface PopupModalProps {
    visible: boolean;
    message: string;
    onClose: () => void;
}

const PopupModal: FC<PopupModalProps> = ({ visible, message, onClose }) => {
    if (!visible) return null; // If not visible, render nothing

    return (
        <div className={styles.popupOverlay}>
            <div className={styles.popup}>
                <p>{message}</p>
                <button className={styles.popupButton} onClick={onClose}>
                    OK
                </button>
            </div>
        </div>
    );
};

export default PopupModal;