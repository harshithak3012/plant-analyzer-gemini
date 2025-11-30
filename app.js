require("dotenv").config();
const express = require("express");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const path = require("path");
const fspromises = fs.promises;
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

/* INIT GEMINI MODEL */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

/* ANALYZE ENDPOINT */
app.post("/analyze", async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: "No image received." });
    }

    if (!image.startsWith("data:image")) {
      return res.status(400).json({ error: "Invalid image format." });
    }

    // MIME & Base64 extraction
    const mimeType = image.substring(
      image.indexOf(":") + 1,
      image.indexOf(";")
    );

    const base64Data = image.split(",")[1];

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Analyze this plant image and provide detailed analysis including species, health condition, diseases, and care recommendations. " +
                "Return the response ONLY as plain text. DO NOT use bold text, headings, markdown symbols, asterisks, bullets, or special formatting."
            },
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
    });

    if (!result?.response?.text) {
      throw new Error("Gemini failed to return a valid text response.");
    }

    let plantInfo = result.response.text();

    plantInfo = plantInfo
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/#+/g, "")
      .replace(/_/g, "")
      .replace(/-/g, "");

    res.json({
      result: plantInfo,
      image: image,
    });
  } catch (error) {
    console.error("Analyze Error:", error);
    res.status(500).json({ error: "An error occurred during analysis." });
  }
});

/* GENERATE PDF */
app.post("/download", async (req, res) => {
  try {
    const { result, image } = req.body;

    if (!result) {
      return res.status(400).json({ error: "Missing analysis text." });
    }

    const reportsDir = path.join(__dirname, "reports");
    await fspromises.mkdir(reportsDir, { recursive: true });

    const filename = `plant_analysis_report_${Date.now()}.pdf`;
    const filePath = path.join(reportsDir, filename);

    const writeStream = fs.createWriteStream(filePath);
    const doc = new PDFDocument();

    doc.pipe(writeStream);

    /* ---------- Header ---------- */
    doc.fontSize(26).text(" Plant Analysis Report", { align: "center" });
    doc.moveDown();
    doc.fontSize(16).text(`Date: ${new Date().toLocaleDateString()}`);
    doc.moveDown(2);

    /* ---------- Analysis Text ---------- */
    doc.fontSize(12).text(result);
    doc.moveDown();

    /* ---------- Image Page ---------- */
    if (image) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      doc.addPage();
      doc.fontSize(18).text("Plant Image", { align: "center" });
      doc.moveDown();

      doc.image(buffer, {
        fit: [500, 350],
        align: "center",
        valign: "center",
      });
    }

    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    res.download(filePath, (err) => {
      if (err) {
        console.error("PDF download error:", err);
      }

      // Delete after sending
      setTimeout(() => {
        fspromises.unlink(filePath).catch(() => {});
      }, 1000);
    });
  } catch (error) {
    console.error("PDF Error:", error);
    res.status(500).json({
      error: "An error occurred while generating the PDF report.",
    });
  }
});

/* START SERVER */
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
