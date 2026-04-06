"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "~/lib/auth-hooks";
import { useRouter } from "next/navigation";
import { Brain, Home, Mail, MessageSquare, Phone, Send } from "lucide-react";
import { ThemeToggle } from "~/app/_components/ThemeToggle";
import LoadingPage from "~/app/_components/loading";
import styles from "~/styles/Employer/Contact.module.css";

const EmployerContactPage = () => {
    const router = useRouter();
    const { isLoaded, userId } = useAuth();
    const [loading, setLoading] = useState(true);
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        subject: "",
        message: "",
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");

    useEffect(() => {
        if (!isLoaded) return;

        if (!userId) {
            window.alert("Authentication failed! Please sign in.");
            router.push("/");
            return;
        }

        // Middleware already enforces role and status for /employer routes.
        setLoading(false);
    }, [userId, router, isLoaded]);

    const handleInputChange = (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setSubmitStatus("idle");

        try {
            // Simulate form submission - replace with actual API call
            await new Promise((resolve) => setTimeout(resolve, 1500));
            setSubmitStatus("success");
            setFormData({ name: "", email: "", subject: "", message: "" });
        } catch (error) {
            console.error("Error submitting contact form:", error);
            setSubmitStatus("error");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (loading) {
        return <LoadingPage />;
    }

    return (
        <div className={styles.container}>
            {/* Navbar */}
            <nav className={styles.navbar}>
                <div className={styles.navContent}>
                    <div className={styles.logoWrapper}>
                        <Brain className={styles.logoIcon} />
                        <span className={styles.logoText}>Launchstack</span>
                    </div>
                    <div className={styles.navActions}>
                        <ThemeToggle />
                        <button
                            onClick={() => router.push("/employer/home")}
                            className={styles.iconButton}
                            aria-label="Go to home"
                        >
                            <Home className={styles.iconButtonIcon} />
                        </button>
                    </div>
                </div>
            </nav>

            {/* Main Content */}
            <main className={styles.main}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Contact Support</h1>
                    <p className={styles.subtitle}>
                        Having technical difficulties? We&apos;re here to help. Send us a message and our team will get back to you as soon as possible.
                    </p>
                </div>

                <div className={styles.contentWrapper}>
                    {/* Contact Form */}
                    <div className={styles.formContainer}>
                        <form onSubmit={handleSubmit} className={styles.form}>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>Name</label>
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleInputChange}
                                    className={styles.input}
                                    placeholder="Your name"
                                    required
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>Email</label>
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleInputChange}
                                    className={styles.input}
                                    placeholder="your.email@company.com"
                                    required
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>Subject</label>
                                <input
                                    type="text"
                                    name="subject"
                                    value={formData.subject}
                                    onChange={handleInputChange}
                                    className={styles.input}
                                    placeholder="Brief description of your issue"
                                    required
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>Message</label>
                                <textarea
                                    name="message"
                                    value={formData.message}
                                    onChange={handleInputChange}
                                    className={styles.textarea}
                                    placeholder="Please describe your technical difficulty in detail..."
                                    rows={6}
                                    required
                                />
                            </div>

                            {submitStatus === "success" && (
                                <div className={styles.successMessage}>
                                    ✓ Message sent successfully! We&apos;ll get back to you soon.
                                </div>
                            )}

                            {submitStatus === "error" && (
                                <div className={styles.errorMessage}>
                                    ✗ Failed to send message. Please try again.
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className={styles.submitButton}
                            >
                                <Send className={styles.buttonIcon} />
                                {isSubmitting ? "Sending..." : "Send Message"}
                            </button>
                        </form>
                    </div>

                    {/* Contact Info Sidebar */}
                    <div className={styles.infoSidebar}>
                        <div className={styles.infoCard}>
                            <Mail className={styles.infoIcon} />
                            <h3 className={styles.infoTitle}>Email</h3>
                            <p className={styles.infoText}>timothylinziqi@gmail.com</p>
                        </div>

                        <div className={styles.infoCard}>
                            <Phone className={styles.infoIcon} />
                            <h3 className={styles.infoTitle}>Phone</h3>
                            <p className={styles.infoText}>667-910-3023</p>
                        </div>

                        <div className={styles.infoCard}>
                            <MessageSquare className={styles.infoIcon} />
                            <h3 className={styles.infoTitle}>Response Time</h3>
                            <p className={styles.infoText}>Within 24 hours</p>
                        </div>

                        <div className={styles.helpNote}>
                            <p className={styles.helpNoteText}>
                                For urgent issues, please call our support line directly.
                            </p>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default EmployerContactPage;

