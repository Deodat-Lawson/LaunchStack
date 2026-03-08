/**
 * Golden test scenarios for each agent domain.
 * Each scenario has known inputs and expected outputs for regression testing.
 */

import type { EvalScenario } from './types';

export const EVAL_SCENARIOS: EvalScenario[] = [
    // ── Predictive Analysis: Contract ──────────────────────────
    {
        id: 'pda-contract-exhibits',
        name: 'Contract with missing exhibits',
        domain: 'predictive-analysis',
        description: 'A contract referencing Exhibit A and Schedule 3, both of which are not included.',
        input: {
            chunks: [
                {
                    content: 'This Agreement is entered into as of January 15, 2026. The terms of the lease are set forth in Exhibit A, attached hereto and incorporated by reference. The payment schedule is described in detail in Schedule 3.',
                    page: 1,
                },
                {
                    content: 'The parties agree to the indemnification provisions outlined in Exhibit B. All disputes shall be resolved in accordance with the arbitration rules specified in Addendum 2.',
                    page: 4,
                },
            ],
            analysisType: 'contract',
        },
        expected: {
            missingDocuments: [
                { documentName: 'Exhibit A', priority: 'high' },
                { documentName: 'Schedule 3', priority: 'high' },
                { documentName: 'Exhibit B', priority: 'high' },
                { documentName: 'Addendum 2', priority: 'medium' },
            ],
            shouldContain: ['Exhibit A', 'Schedule 3'],
            shouldNotContain: ['no missing documents'],
        },
    },

    // ── Predictive Analysis: Clean Document ────────────────────
    {
        id: 'pda-no-missing',
        name: 'Self-contained document with no references',
        domain: 'predictive-analysis',
        description: 'A document that does not reference any external documents.',
        input: {
            chunks: [
                {
                    content: 'The company was founded in 2020 with a focus on sustainable energy. Our mission is to provide affordable solar solutions to residential customers. This report covers Q3 2025 financial performance.',
                    page: 1,
                },
                {
                    content: 'Revenue grew 23% year-over-year to $4.2M. Operating expenses decreased by 8% due to supply chain optimization. Net income was $890K, a 15% improvement over Q2.',
                    page: 2,
                },
            ],
            analysisType: 'financial',
        },
        expected: {
            missingDocuments: [],
            shouldNotContain: ['missing'],
        },
    },

    // ── Predictive Analysis: Educational ───────────────────────
    {
        id: 'pda-educational-syllabus',
        name: 'Course material referencing syllabus and readings',
        domain: 'predictive-analysis',
        description: 'Lecture slides referencing a syllabus, required readings, and a YouTube video.',
        input: {
            chunks: [
                {
                    content: 'CS 601.315 — User Interface Design. Please refer to the course syllabus for grading policies. Homework 1 is due February 20. Read Chapter 5 of "Designing the User Experience" by Hartson & Pyla.',
                    page: 1,
                },
                {
                    content: 'Watch the Design Sprint video before next class: https://youtu.be/x-DLQp9xb20. Post your self-introduction on Courselore by Friday. Academic integrity code applies to all submissions.',
                    page: 3,
                },
            ],
            analysisType: 'educational',
        },
        expected: {
            missingDocuments: [
                { documentName: 'course syllabus', priority: 'high' },
            ],
            shouldContain: ['syllabus'],
            minInsightCount: 2,
            expectedCategories: ['deadline', 'resource', 'action-item', 'caveat'],
        },
    },

    // ── Document Q&A: Factual Extraction ──────────────────────
    {
        id: 'qa-factual-extraction',
        name: 'Factual question with clear answer in source',
        domain: 'document-qa',
        description: 'A direct factual question where the answer exists verbatim in the source.',
        input: {
            chunks: [
                {
                    content: 'The company policy requires all employees to complete safety training within 30 days of their start date. Failure to complete training will result in suspension of access privileges.',
                    page: 5,
                },
            ],
            question: 'How many days do new employees have to complete safety training?',
        },
        expected: {
            shouldContain: ['30 days'],
            shouldNotContain: ['I don\'t know', 'not mentioned'],
        },
    },

    // ── Document Q&A: Not in Document ─────────────────────────
    {
        id: 'qa-not-in-document',
        name: 'Question about content not in the document',
        domain: 'document-qa',
        description: 'The question asks about something not covered in the source chunks.',
        input: {
            chunks: [
                {
                    content: 'The company policy requires all employees to complete safety training within 30 days of their start date.',
                    page: 5,
                },
            ],
            question: 'What is the dress code policy?',
        },
        expected: {
            shouldNotContain: ['The dress code is', 'Employees must wear'],
        },
    },

    // ── Predictive Analysis: HR ───────────────────────────────
    {
        id: 'pda-hr-handbook',
        name: 'HR document referencing employee handbook',
        domain: 'predictive-analysis',
        description: 'An onboarding checklist that references the employee handbook and benefits guide.',
        input: {
            chunks: [
                {
                    content: 'New Employee Onboarding Checklist: 1. Sign the offer letter. 2. Review the Employee Handbook (available on the company intranet). 3. Complete I-9 form. 4. Review the Benefits Guide for health insurance options.',
                    page: 1,
                },
                {
                    content: 'Please refer to the IT Security Policy for acceptable use guidelines. Set up your workstation per the Setup Guide provided by IT.',
                    page: 2,
                },
            ],
            analysisType: 'hr',
        },
        expected: {
            missingDocuments: [
                { documentName: 'Employee Handbook', priority: 'high' },
                { documentName: 'Benefits Guide', priority: 'medium' },
            ],
            shouldContain: ['Employee Handbook'],
        },
    },

];
