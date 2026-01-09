import PacmanGame from "./PacmanGame";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.container}>
      <PacmanGame />
    </div>
  );
}
