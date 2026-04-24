'use client';

import React, { type FormEvent, useState } from 'react';
import { ChevronDown, Mail, MessageSquare, Plus } from 'lucide-react';
import emailjs from '@emailjs/browser';
import { MarketingShell } from '../_components/MarketingShell';
import styles from '../../styles/marketing.module.css';

interface ContactForm {
  from_name: string;
  to_name: string;
  from_email: string;
  subject: string;
  message: string;
}

const faqs = [
  {
    q: 'How long does the approval process take?',
    a: "The typical approval process takes 1-2 business days. You'll receive an email notification once your account has been approved.",
  },
  {
    q: 'What file formats are supported?',
    a: 'Launchstack supports PDFs, DOCX, MD, images, audio (MP3/WAV/M4A), video (MP4/MOV), and most structured formats (CSV, JSON, XLSX). Media is automatically transcribed, images are OCR\u2019d.',
  },
  {
    q: 'How secure are my documents?',
    a: 'Self-hosted deployments keep every byte on your infrastructure — nothing leaves your environment except LLM calls you explicitly enable.',
  },
  {
    q: 'Can I change my employee invite code?',
    a: 'Yes, you can rotate your invite code through your account settings once your account is approved.',
  },
  {
    q: 'How do I add multiple employees?',
    a: 'As an employer, you can manage employees through the Employee Management dashboard. Each employee signs up with your company code.',
  },
];

export default function ContactPage() {
  const [expanded, setExpanded] = useState<number | null>(0);
  const [formData, setFormData] = useState<ContactForm>({
    from_name: '',
    from_email: '',
    to_name: 'Launchstack Support',
    subject: '',
    message: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      emailjs
        .send(
          'service_q0kr5dd',
          'template_vaka75k',
          formData as unknown as Record<string, unknown>,
          { publicKey: 'DSuoTHVw3sJe7tFVJ' },
        )
        .then(
          () => console.log('SUCCESS!'),
          (error) => console.log('FAILED...', error),
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
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <MarketingShell>
      <section className={styles.pageHero}>
        <div className={styles.eyebrow}>Contact</div>
        <h1 className={styles.pageTitle}>
          Say hi, or <span className={styles.serif}>ask us anything.</span>
        </h1>
        <p className={styles.pageSub}>
          We read every message. Fastest path for support or sales questions —
          drop a note below and we&rsquo;ll get back to you.
        </p>
      </section>

      <section className={styles.section} style={{ paddingTop: 0 }}>
        <div className={styles.container}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
              gap: 20,
              alignItems: 'start',
            }}
          >
            <form
              onSubmit={handleSubmit}
              style={{
                padding: 28,
                borderRadius: 18,
                background: 'var(--panel)',
                border: '1px solid var(--line-2)',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <h2 style={sectionTitleStyle}>
                <MessageSquare size={18} style={{ color: 'var(--accent)' }} />
                Contact us
              </h2>

              <Field label="Name" name="from_name" value={formData.from_name} onChange={handleChange} />
              <Field label="Email" name="from_email" type="email" value={formData.from_email} onChange={handleChange} />
              <Field label="Subject" name="subject" value={formData.subject} onChange={handleChange} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle} htmlFor="message">Message</label>
                <textarea
                  id="message"
                  name="message"
                  value={formData.message}
                  onChange={handleChange}
                  rows={5}
                  required
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 120 }}
                />
              </div>

              <button
                type="submit"
                className={`${styles.btn} ${styles.btnAccent} ${styles.btnLg}`}
                disabled={isSubmitting}
                style={{ alignSelf: 'flex-start' }}
              >
                <Mail size={16} />
                {isSubmitting ? 'Sending…' : 'Send message'}
              </button>

              {submitStatus === 'success' && (
                <p style={{ color: 'oklch(0.5 0.18 150)', fontSize: 13 }}>
                  Message sent successfully! We&rsquo;ll get back to you soon.
                </p>
              )}
              {submitStatus === 'error' && (
                <p style={{ color: 'oklch(0.5 0.2 30)', fontSize: 13 }}>
                  Oops! Something went wrong. Please try again.
                </p>
              )}
            </form>

            <div
              style={{
                padding: 28,
                borderRadius: 18,
                background: 'var(--panel)',
                border: '1px solid var(--line-2)',
              }}
            >
              <h2 style={sectionTitleStyle}>Frequently asked</h2>
              <div className={styles.faq}>
                {faqs.map((f, i) => (
                  <div
                    key={f.q}
                    className={`${styles.faqItem} ${expanded === i ? styles.faqItemOpen : ''}`}
                  >
                    <div
                      className={styles.faqQ}
                      onClick={() => setExpanded(expanded === i ? null : i)}
                    >
                      {f.q}
                      {expanded === i ? <Plus size={18} /> : <ChevronDown size={18} />}
                    </div>
                    <div className={styles.faqA}>{f.a}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--ink-3)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const inputStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  color: 'var(--ink)',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--ink)',
  letterSpacing: '-0.01em',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 6,
};

function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={labelStyle} htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        required
        style={inputStyle}
      />
    </div>
  );
}
