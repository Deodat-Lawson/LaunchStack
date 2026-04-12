"use client"
import React, { type FormEvent, useState } from 'react';
import { Mail, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import styles from '~/styles/SupportPage.module.css';
import emailjs from '@emailjs/browser';
import { Navbar } from '../_components/Navbar';




interface ContactForm {
    from_name: string;
    to_name: string;
    from_email: string;
    subject: string;
    message: string;
}

const faqs = [
    {
        question: "How long does the approval process take?",
        answer: "The typical approval process takes 1-2 business days. You'll receive an email notification once your account has been approved."
    },
    {
        question: "What file formats are supported?",
        answer: "Currently, we support PDF documents. Support for additional formats like DOCX and TXT will be added in future updates."
    },
    {
        question: "How secure are my documents?",
        answer: "We employ enterprise-grade encryption and security measures. All documents are encrypted at rest and in transit."
    },
    {
        question: "Can I change my employee invite code?",
        answer: "Yes, you can change your invite code through your account settings once your account is approved."
    },
    {
        question: "How do I add multiple employees?",
        answer: "As an employer, you can manage employees through the Employee Management dashboard. Each employee will need to create their own account using your company code."
    }
];

const SupportPage = () => {
    const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
    const [formData, setFormData] = useState<ContactForm>({
        from_name: '',
        from_email: '',
        to_name: 'Launchstack Support',
        subject: '',
        message: ''
    });

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            emailjs
                .send('service_q0kr5dd', 'template_vaka75k', formData as unknown as Record<string, unknown>, {
                    publicKey: 'DSuoTHVw3sJe7tFVJ',
                })
                .then(
                    () => {
                        console.log('SUCCESS!');
                    },
                    (error) => {
                        console.log('FAILED...', error);
                    },
                );

            setSubmitStatus('success');
            setFormData({ from_name: '', from_email: '', to_name: '', subject: '', message: '' });
        } catch (error) {
            console.error('Error sending email:', error);
            setSubmitStatus('error');
        } finally {
            setIsSubmitting(false);
            setTimeout(() => setSubmitStatus('idle'), 3000);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    return (
            <div className={styles.container}>
                <Navbar />

                <main className={styles.main}>
                    <div className={styles.header}>
                        <h1 className={styles.title}>Support & Help Center</h1>
                        <p className={styles.subtitle}>Get help with your account and find answers to common questions</p>
                    </div>

                    <div className={styles.contentGrid}>
                        {/* Contact Form Section */}
                        <section className={styles.contactSection}>
                            <h2 className={styles.sectionTitle}>
                                <MessageSquare className={styles.sectionIcon} />
                                Contact Us
                            </h2>
                            <form onSubmit={handleSubmit} className={styles.contactForm}>
                                <div className={styles.formGroup}>
                                    <label htmlFor="name" className={styles.label}>Name</label>
                                    <input
                                        type="text"
                                        id="from_name"
                                        name="from_name"
                                        value={formData.from_name}
                                        onChange={handleChange}
                                        className={styles.input}
                                        required
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label htmlFor="email" className={styles.label}>Email</label>
                                    <input
                                        type="email"
                                        id="from_email"
                                        name="from_email"
                                        value={formData.from_email}
                                        onChange={handleChange}
                                        className={styles.input}
                                        required
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label htmlFor="subject" className={styles.label}>Subject</label>
                                    <input
                                        type="text"
                                        id="subject"
                                        name="subject"
                                        value={formData.subject}
                                        onChange={handleChange}
                                        className={styles.input}
                                        required
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label htmlFor="message" className={styles.label}>Message</label>
                                    <textarea
                                        id="message"
                                        name="message"
                                        value={formData.message}
                                        onChange={handleChange}
                                        className={styles.textarea}
                                        rows={5}
                                        required
                                    />
                                </div>

                                <button type="submit" className={styles.submitButton} disabled={isSubmitting}>
                                    <Mail className={styles.buttonIcon} />
                                    {isSubmitting ? 'Sending...' : 'Send Message'}
                                </button>

                                {submitStatus === 'success' && (
                                    <p className={styles.successMessage}>
                                        Message sent successfully! I will get back to you soon.
                                    </p>
                                )}

                                {submitStatus === 'error' && (
                                    <p className={styles.errorMessage}>
                                        Oops! Something went wrong. Please try again.
                                    </p>
                                )}

                            </form>
                        </section>

                        {/* FAQ Section */}
                        <section className={styles.faqSection}>
                            <h2 className={styles.sectionTitle}>Frequently Asked Questions</h2>
                            <div className={styles.faqList}>
                                {faqs.map((faq, index) => (
                                    <div
                                        key={index}
                                        className={`${styles.faqItem} ${expandedFaq === index ? styles.expanded : ''}`}
                                    >
                                        <button
                                            className={styles.faqButton}
                                            onClick={() => setExpandedFaq(expandedFaq === index ? null : index)}
                                        >
                                            <span>{faq.question}</span>
                                            {expandedFaq === index ? (
                                                <ChevronUp className={styles.faqIcon} />
                                            ) : (
                                                <ChevronDown className={styles.faqIcon} />
                                            )}
                                        </button>
                                        {expandedFaq === index && (
                                            <div className={`${styles.faqAnswer}`}>
                                                {faq.answer}
                                            </div>
                                        )}

                                    </div>
                                ))}
                            </div>
                        </section>
                    </div>
                </main>
            </div>
    );
};

export default SupportPage;