import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <p>farmhand</p>
    </StrictMode>,
  );
