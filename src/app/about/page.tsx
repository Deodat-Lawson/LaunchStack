"use client"

import React from 'react';
import Image from 'next/image';
import { Github, Linkedin, Mail } from 'lucide-react';
import styles from '../../styles/about.module.css';
import { Navbar } from '../_components/Navbar';
import { ClerkProvider } from '@clerk/nextjs';

const teamMembers = [
    {
        id: 1,
        name: 'Richard Zhou',
        role: 'Founder and CEO',
        description: 'Director overseeing full-stack development with a focus on AI integration and document processing systems. Leads the strategic and technical development of Launchstack.',
        image: '/api/placeholder/400/400',
        email: 'richardzhou1688@gmail.com',
        github: 'https://github.com/DuckyCodes',
        linkedin: 'https://www.linkedin.com/in/richard-zhou-22ab60249/'
    },
    {
        id: 2,
        name: 'Timothy Lin',
        role: 'Tech Lead',
        description: 'Developed and built the Launchstack platform. Specializes in full-stack development, AI integration, and Machine Learning. Leads the technical development of Launchstack.',
        image: 'https://h0xotvuawi.ufs.sh/f/KSLubuOGoQY2NnwtVGR6HJrBbtv7fyQpxVMN4nEGLsh1mcT9',
        email: 'tlin56@jh.edu',
        github: 'https://github.com/Deodat-Lawson',
        linkedin: 'https://www.linkedin.com/in/tlin2004/'
    }
];

export default function About() {
    return (
        <ClerkProvider>
            <div className={styles.container}>
                <Navbar />

            <main className={styles.main}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Meet Our Team</h1>
                    <p className={styles.subtitle}>
                        The minds behind Launchstack, working to make professional documents easier to read and interpret.
                    </p>
                </div>

                <div className={styles.teamGrid}>
                    {teamMembers.map(member => (
                        <div key={member.id} className={styles.memberCard}>
                            <div className={styles.memberImageContainer}>
                                <Image
                                    src={member.image}
                                    alt={member.name}
                                    className={styles.memberImage}
                                    width={400}
                                    height={400}
                                />
                            </div>
                            <div className={styles.memberInfo}>
                                <h2 className={styles.memberName}>{member.name}</h2>
                                <p className={styles.memberRole}>{member.role}</p>
                                <p className={styles.memberDescription}>
                                    {member.description}
                                </p>
                                <div className={styles.socialLinks}>
                                    <a
                                        href={`mailto:${member.email}`}
                                        className={styles.socialLink}
                                        aria-label="Email"
                                    >
                                        <Mail className={styles.socialIcon} />
                                    </a>
                                    <a
                                        href={`${member.github}`}
                                        className={styles.socialLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label="GitHub"
                                    >
                                        <Github className={styles.socialIcon} />
                                    </a>
                                    <a
                                        href={`${member.linkedin}`}
                                        className={styles.socialLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label="LinkedIn"
                                    >
                                        <Linkedin className={styles.socialIcon} />
                                    </a>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className={styles.missionSection}>
                    <h2 className={styles.missionTitle}>Our Mission</h2>
                    <p className={styles.missionText}>
                        To revolutionize how professionals interact with documents through cutting-edge AI technology. 
                        We&apos;re building the future of predictive document analysis and intelligent company management, 
                        making complex document workflows simple, efficient, and secure for enterprises worldwide.
                    </p>
                </div>
            </main>
            </div>
        </ClerkProvider>
    );
}
