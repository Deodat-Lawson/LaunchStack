import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface ResetPasswordProps {
  resetUrl: string;
}

export const ResetPassword: React.FC<ResetPasswordProps> = ({ resetUrl }) => (
  <Html>
    <Head />
    <Preview>Reset your Launchstack password</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Heading style={logo}>Launchstack</Heading>
        </Section>

        <Section style={content}>
          <Heading as="h2" style={title}>
            Reset your password
          </Heading>
          <Text style={paragraph}>
            We received a request to reset your password. Click the button below
            to choose a new one. This link will expire in 1 hour.
          </Text>
          <Section style={buttonSection}>
            <Button style={button} href={resetUrl}>
              Reset Password
            </Button>
          </Section>
          <Text style={hint}>
            If the button doesn&apos;t work, copy and paste this link into your
            browser:
          </Text>
          <Text style={link}>{resetUrl}</Text>
        </Section>

        <Hr style={divider} />
        <Text style={footer}>
          If you didn&apos;t request a password reset, you can safely ignore
          this email. Your password will remain unchanged.
        </Text>
      </Container>
    </Body>
  </Html>
);

export default ResetPassword;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const main: React.CSSProperties = {
  backgroundColor: "#f6f6f9",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

const container: React.CSSProperties = {
  maxWidth: "480px",
  margin: "40px auto",
  backgroundColor: "#ffffff",
  borderRadius: "12px",
  overflow: "hidden",
};

const header: React.CSSProperties = {
  backgroundColor: "#9333ea",
  padding: "24px 32px",
};

const logo: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "20px",
  fontWeight: 700,
  margin: 0,
};

const content: React.CSSProperties = {
  padding: "32px",
};

const title: React.CSSProperties = {
  fontSize: "22px",
  fontWeight: 700,
  color: "#1a1a1a",
  margin: "0 0 12px",
};

const paragraph: React.CSSProperties = {
  fontSize: "15px",
  lineHeight: "24px",
  color: "#4b5563",
  margin: "0 0 24px",
};

const buttonSection: React.CSSProperties = {
  textAlign: "center" as const,
  marginBottom: "24px",
};

const button: React.CSSProperties = {
  backgroundColor: "#9333ea",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  textDecoration: "none",
  borderRadius: "8px",
  padding: "12px 32px",
  display: "inline-block",
};

const hint: React.CSSProperties = {
  fontSize: "13px",
  color: "#6b7280",
  margin: "0 0 4px",
};

const link: React.CSSProperties = {
  fontSize: "13px",
  color: "#9333ea",
  wordBreak: "break-all" as const,
  margin: "0 0 0",
};

const divider: React.CSSProperties = {
  borderColor: "#e5e7eb",
  margin: "0 32px",
};

const footer: React.CSSProperties = {
  fontSize: "12px",
  color: "#9ca3af",
  padding: "16px 32px 24px",
  lineHeight: "20px",
};
