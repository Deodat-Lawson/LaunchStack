import type { Metadata } from 'next';
import React from 'react';
import { PricingClient } from './PricingClient';

export const metadata: Metadata = {
  title: 'Pricing — Free & Open Source for Every Founder',
  description:
    'Launchstack is completely free and open source. Self-host with your own API keys or try the hosted demo. No hidden costs, no usage limits, no vendor lock-in.',
  alternates: { canonical: '/pricing' },
};

export default function PricingPage() {
  return <PricingClient />;
}
