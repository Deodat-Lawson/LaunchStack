import type { Metadata } from 'next';
import React from 'react';
import { PricingClient } from './PricingClient';

export const metadata: Metadata = {
  title: 'Pricing — Free & Open Source for Every Founder',
  description:
    'Launchstack is completely free and open source. Self-host the full stack with your own API keys — no paid plans, no hidden costs, no vendor lock-in.',
  alternates: { canonical: '/pricing' },
};

export default function PricingPage() {
  return <PricingClient />;
}
