import Link from "next/link";
import React, {type FC, type ReactNode} from 'react';
import { Brain, Zap, ArrowRight, Shield, Clock, Users, TrendingUp, Star, Search, BarChart3, Building2, FileSearch, Upload, Sparkles, CheckCircle } from 'lucide-react';
import styles from '../styles/home.module.css';
import { Navbar } from './_components/Navbar';


interface FeatureCardProps {
    icon: ReactNode;
    title: string;
    description: string;
}

interface BenefitItemProps {
    icon: ReactNode;
    title: string;
    description: string;
}


export default function HomePage() {
    return (
        <div className={styles['documind-container']}>
            <Navbar />

                <div className={styles['hero-section']}>
                    <div className={styles['hero-content']}>
                        <h1 className={styles['hero-title']}>
                            Professional Document Reader AI
                        </h1>
                        <p className={styles['hero-description']}>
                            Transform how your team analyzes and interprets professional documents with cutting-edge AI technology. Features predictive document analysis, intelligent company management tools, and enterprise-grade security.
                        </p>
                        <div className={styles['hero-buttons']}>
                            <Link href="/signup">
                                <button className={`${styles.btn} ${styles['btn-primary']} ${styles['btn-lg']}`}>
                                    Start Free Trial
                                    <ArrowRight className="ml-2 w-5 h-5" />
                                </button>
                            </Link>
                            <Link href="/contact">
                                <button className={`${styles.btn} ${styles['btn-outline']} ${styles['btn-lg']}`}>
                                    Schedule Demo
                                </button>
                            </Link>
                        </div>
                    </div>
                </div>
  
                <div className={styles['features-section']}>
                    <div className={styles['features-container']}>
                        <h2 className={styles['features-title']}>
                            Powerful AI-Driven Features
                        </h2>
                        <p className={styles['features-subtitle']}>
                            Comprehensive document analysis and management platform designed for modern enterprises
                        </p>
                        <div className={styles['features-grid']}>
                            <FeatureCard
                                icon={<FileSearch className={styles['icon-purple']} />}
                                title="Predictive Document Analysis"
                                description="Advanced AI identifies missing documents, suggests related files, and predicts document requirements based on your existing content. Smart analysis reduces compliance risks and ensures completeness."
                            />
                            <FeatureCard
                                icon={<Building2 className={styles['icon-purple']} />}
                                title="Company Management Tools"
                                description="Comprehensive employee management system with role-based access control, document approval workflows, and team collaboration features designed for enterprise environments."
                            />
                            <FeatureCard
                                icon={<Brain className={styles['icon-purple']} />}
                                title="AI Q&A Engine"
                                description="Intelligent question-answering system trained on professional documents. Get instant answers with page references, context-aware responses, and detailed explanations."
                            />
                            <FeatureCard
                                icon={<BarChart3 className={styles['icon-purple']} />}
                                title="Analytics & Insights"
                                description="Real-time analytics dashboard tracking document usage, team productivity, AI accuracy metrics, and compliance status with detailed reporting capabilities."
                            />
                            <FeatureCard
                                icon={<Search className={styles['icon-purple']} />}
                                title="Smart Document Search"
                                description="Semantic search across all company documents with AI-powered content understanding. Find relevant information instantly with natural language queries."
                            />
                            <FeatureCard
                                icon={<Zap className={styles['icon-purple']} />}
                                title="Automated Processing"
                                description="Automated document categorization, content extraction, and workflow routing. Streamline document management with intelligent automation and bulk processing."
                            />
                        </div>
                    </div>
                </div>

                <div className={styles['benefits-section']}>
                    <div className={styles['benefits-grid']}>
                        <div className={styles['benefits-content']}>
                            <h2 className={styles['benefits-title']}>
                                Why Choose PDR-AI?
                            </h2>
                            <p className={styles['benefits-subtitle']}>
                                Join thousands of professionals who have transformed their document workflow with our comprehensive AI platform featuring predictive analysis and advanced company management.
                            </p>
                            <div className={styles['benefits-list']}>
                                <BenefitItem 
                                    icon={<Clock className={styles['benefit-icon']} />}
                                    title="Save 80% of Reading Time"
                                    description="Predictive document analysis automatically identifies missing documents and suggests relevant content, dramatically reducing manual review time"
                                />
                                <BenefitItem 
                                    icon={<TrendingUp className={styles['benefit-icon']} />}
                                    title="Predictive Compliance"
                                    description="AI-powered document analysis predicts potential compliance gaps and missing requirements before they become issues"
                                />
                                <BenefitItem 
                                    icon={<Users className={styles['benefit-icon']} />}
                                    title="Advanced Team Management"
                                    description="Comprehensive company management tools with role-based access, approval workflows, and team collaboration features"
                                />
                                <BenefitItem 
                                    icon={<Shield className={styles['benefit-icon']} />}
                                    title="Enterprise Security"
                                    description="Bank-level security with advanced user management, audit trails, and compliance reporting for regulated industries"
                                />
                                <BenefitItem 
                                    icon={<Star className={styles['benefit-icon']} />}
                                    title="24/7 Expert Support"
                                    description="Dedicated support team with expertise in document analysis, predictive AI, and enterprise document management"
                                />
                            </div>
                        </div>
                        
                        <div className={styles['workflow-container']}>
                            <div className={styles['workflow-card']}>
                                <div className={styles['workflow-header']}>
                                    <h3 className={styles['workflow-title']}>
                                        How PDR-AI Works
                                    </h3>
                                    <p className={styles['workflow-description']}>
                                        Intelligent document processing powered by cutting-edge AI
                                    </p>
                                </div>
                                
                                <div className={styles['workflow-diagram']}>
                                    <div className={styles['workflow-step']}>
                                        <div className={styles['workflow-step-icon']}>
                                            <Upload className={styles['workflow-icon']} />
                                        </div>
                                        <div className={styles['workflow-step-content']}>
                                            <h4 className={styles['workflow-step-title']}>1. Upload</h4>
                                            <p className={styles['workflow-step-text']}>Upload documents to your secure workspace</p>
                                        </div>
                                        <div className={styles['workflow-connector']}></div>
                                    </div>

                                    <div className={styles['workflow-step']}>
                                        <div className={styles['workflow-step-icon']}>
                                            <FileSearch className={styles['workflow-icon']} />
                                        </div>
                                        <div className={styles['workflow-step-content']}>
                                            <h4 className={styles['workflow-step-title']}>2. File Identification</h4>
                                            <p className={styles['workflow-step-text']}>Identify, categorize and graph the files in the database</p>
                                        </div>
                                        <div className={styles['workflow-connector']}></div>
                                    </div>

                                    <div className={styles['workflow-step']}>
                                        <div className={styles['workflow-step-icon']}>
                                            <Sparkles className={styles['workflow-icon']} />
                                        </div>
                                        <div className={styles['workflow-step-content']}>
                                            <h4 className={styles['workflow-step-title']}>3. Document Analysis</h4>
                                            <p className={styles['workflow-step-text']}>Analyzes the document and provides insights</p>
                                        </div>  
                                        <div className={styles['workflow-connector']}></div>
                                    </div>


                                    <div className={styles['workflow-step']}>
                                        <div className={styles['workflow-step-icon']}>
                                            <Brain className={styles['workflow-icon']} />
                                        </div>
                                        <div className={styles['workflow-step-content']}>
                                            <h4 className={styles['workflow-step-title']}>4. AI Analysis</h4>
                                            <p className={styles['workflow-step-text']}>Advanced AI processes and queries</p>
                                        </div>
                                        <div className={styles['workflow-connector']}></div>
                                    </div>



                                    <div className={styles['workflow-step']}>
                                        <div className={`${styles['workflow-step-icon']} ${styles['workflow-final-icon']}`}>
                                            <CheckCircle className={styles['workflow-icon']} />
                                        </div>
                                        <div className={styles['workflow-step-content']}>
                                            <h4 className={styles['workflow-step-title']}>5. Insights</h4>
                                            <p className={styles['workflow-step-text']}>Get actionable insights and complete compliance</p>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className={styles['stats-grid']}>
                                    <div className={styles['stat-item']}>
                                        <div className={styles['stat-number']}>5k+</div>
                                        <div className={styles['stat-label']}>Documents Analyzed</div>
                                    </div>
                                    <div className={styles['stat-item']}>
                                        <div className={styles['stat-number']}>99%</div>
                                        <div className={styles['stat-label']}>Prediction Accuracy</div>
                                    </div>
                                    <div className={styles['stat-item']}>
                                        <div className={styles['stat-number']}>50+</div>
                                        <div className={styles['stat-label']}>Companies Managed</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles['cta-section']}>
                    <div className={styles['cta-container']}>
                        <h2 className={styles['cta-title']}>
                            Ready to Transform Your Document Workflow?
                        </h2>
                        <p className={styles['cta-description']}>
                            Experience the power of predictive document analysis and advanced company management tools. Join thousands of professionals who have revolutionized their document processes with PDR-AI.
                        </p>
                        <div className={styles['cta-buttons']}>
                            <Link href="/signup">
                                <button className={`${styles.btn} ${styles['btn-lg']}`} style={{backgroundColor: 'white', color: '#7c3aed'}}>
                                    Start Your Free Trial
                                    <ArrowRight className="ml-2 w-5 h-5" />
                                </button>
                            </Link>
                            <Link href="/contact">
                                <button className={`${styles.btn} ${styles['btn-outline']} ${styles['btn-lg']}`} style={{borderColor: 'white', color: 'white'}}>
                                    Contact Sales
                                </button>
                            </Link>
                        </div>
                    </div>
                </div>
        </div>
    );
}

const FeatureCard: FC<FeatureCardProps> = ({ icon, title, description }) => (
    <div className={styles['feature-card']}>
        <div className={styles['feature-icon']}>
            {icon}
        </div>
        <h3 className={styles['feature-title']}>{title}</h3>
        <p className={styles['feature-description']}>{description}</p>
    </div>
);

const BenefitItem: FC<BenefitItemProps> = ({ icon, title, description }) => (
    <div className={styles['benefit-item']}>
        {icon}
        <div className={styles['benefit-content']}>
            <h4 className={styles['benefit-title']}>{title}</h4>
            <p className={styles['benefit-text']}>{description}</p>
        </div>
    </div>
);