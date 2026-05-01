import styles from "./AmbientBackground.module.css";

export function AmbientBackground() {
  return (
    <div className={styles.layer} aria-hidden="true">
      <div className={`${styles.orb} ${styles.orb1}`} />
      <div className={`${styles.orb} ${styles.orb2}`} />
      <div className={`${styles.orb} ${styles.orb3}`} />
      <div className={styles.dots} />
    </div>
  );
}
