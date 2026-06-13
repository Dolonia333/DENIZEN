import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const root = document.getElementById("root")!;
document.getElementById("crm-boot")?.remove();
createRoot(root).render(<App />);
