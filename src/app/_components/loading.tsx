import React from 'react';
import { Brain, Loader } from 'lucide-react';
import styles from '../../styles/authenticating.module.css';

interface LoadingPageProps {
    message?: string;
    title?: string;
}

const LoadingPage: React.FC<LoadingPageProps> = ({
    message = "Please wait while we set up your workspace",
    title = "Loading"
}) => {
    return (
        <div className={styles.container} role="status" aria-live="polite">
            <div className={styles.content}>
                <div className={styles.logoWrapper}>
                    <Brain
                        className={styles.logoIcon}
                        aria-hidden="true"
                        role="img"
                        aria-label="Launchstack Brain Icon"
                    />
                    <span className={styles.logoText}>Launchstack</span>
                </div>

                <div className={styles.spinnerContainer}>
                    <div className={styles.spinner} aria-hidden="true"></div>
                    <div className={styles.spinnerInner}>
                        <Loader
                            className={styles.spinnerIcon}
                            aria-hidden="true"
                            role="img"
                            aria-label="Loading Spinner"
                        />
                    </div>
                </div>

                <div className={styles.progressContainer} aria-hidden="true">
                    <div className={styles.progressBar}></div>
                </div>

                <div className={styles.loadingContainer}>
                    <div className={styles.dots} aria-hidden="true">
                        <div className={styles.dot}></div>
                        <div className={styles.dot}></div>
                        <div className={styles.dot}></div>
                    </div>
                    <h1 className={styles.loadingText}>{title}</h1>
                </div>

                <p className={styles.message}>
                    {message}
                </p>
            </div>
        </div>
    );
};

export default LoadingPage;