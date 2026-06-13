import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import type { Quote } from "@/lib/crm-data";
import { generateProposalHTML, proposalFilename, type ProposalBranding } from "@/lib/proposal-document";

async function renderHtmlToCanvas(html: string): Promise<HTMLCanvasElement> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "794px";
  host.style.background = "#ffffff";
  host.innerHTML = html;
  document.body.appendChild(host);

  try {
    await new Promise((r) => setTimeout(r, 120));
    return await html2canvas(host, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });
  } finally {
    document.body.removeChild(host);
  }
}

export async function generateProposalPdfBlob(quote: Quote, branding: ProposalBranding): Promise<Blob> {
  const html = generateProposalHTML(quote, branding);
  const canvas = await renderHtmlToCanvas(html);
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const imgData = canvas.toDataURL("image/png");

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  return pdf.output("blob");
}

export async function downloadProposalPdf(quote: Quote, branding: ProposalBranding): Promise<Blob> {
  const blob = await generateProposalPdfBlob(quote, branding);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = proposalFilename(quote);
  a.click();
  URL.revokeObjectURL(url);
  return blob;
}

export async function proposalPdfBase64(quote: Quote, branding: ProposalBranding): Promise<{ base64: string; filename: string }> {
  const blob = await generateProposalPdfBlob(quote, branding);
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return {
    base64: btoa(binary),
    filename: proposalFilename(quote),
  };
}
