from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
import firebase_admin
from firebase_admin import credentials, firestore
import fitz  # PyMuPDF for PDFs
import docx   # python-docx for .docx files
import re     # used in parse_mcq_text()

app = Flask(__name__)
CORS(app)  # Enables CORS for all routes

# Configure Gemini API key (replace with your actual key)
genai.configure(api_key="AIzaSyBnH0YnlQ9f_l8IC1YOX0NNf7ndirqfmZ8")

# Initialize Firebase Admin SDK for Firestore
cred = credentials.Certificate(
    r"C:\wamp64\www\secrets\testbase-ca192-firebase-adminsdk-fbsvc-70b69341fd.json"
)
firebase_admin.initialize_app(cred)
db = firestore.client()

@app.route("/generate", methods=["POST"])
def generate():
    data = request.json
    prompt = data.get("prompt", "")
    try:
        model = genai.GenerativeModel("models/gemini-2.5-flash")
        response = model.generate_content(prompt)
        mcq_text = response.text
        return jsonify({"result": mcq_text})
    except Exception as e:
        return jsonify({"error": str(e)})


def parse_mcq_text(mcq_text):
    blocks = re.split(r'\n\s*\n', mcq_text.strip())
    result = []
    for block in blocks:
        q_match = re.search(r'\*\*\d+\.\s*Question:\*\*\s*(.+)', block)
        if not q_match:
            continue
        question = q_match.group(1).strip()

        options = []
        for opt_match in re.finditer(r'\*\s+([A-D])\)\s+(.+)', block):
            options.append(opt_match.group(2).strip())

        correct_match = re.search(r'\*\*Correct Answer:\s*([A-D])\)\s+(.+)\*\*', block)
        correct = correct_match.group(2).strip() if correct_match else ""

        result.append({
            "Question": question,
            "Options": options,
            "Correct": correct
        })
    return result


@app.route("/upload_mcqs", methods=["POST"])
def upload_mcqs():
    data = request.json
    quiz_title = data.get("quizTitle", "[Quiz] Week One")
    
    if "mcq_text" in data:
        mcqs = parse_mcq_text(data["mcq_text"])
    else:
        mcqs = data.get("questions", [])
    
    for idx, mcq in enumerate(mcqs, start=1):
        doc_id = f"{quiz_title} Q{idx}"
        db.collection('is216').document(doc_id).set(mcq)
    
    response = {"status": "success", "count": len(mcqs)}
    print(response)
    return jsonify(response)


# ✅ NEW FILE UPLOAD ROUTE (leave your MCQ logic untouched)
@app.route("/upload", methods=["POST"])
def upload_file():
    file = request.files["file"]
    name = file.filename.lower()
    text = ""

    try:
        # .txt
        if name.endswith(".txt"):
            text = file.read().decode("utf-8")

        # .pdf using PyMuPDF
        elif name.endswith(".pdf"):
            pdf = fitz.open(stream=file.read(), filetype="pdf")
            for p in pdf:
                text += p.get_text()

        # .docx
        elif name.endswith(".docx"):
            doc = docx.Document(file)
            for para in doc.paragraphs:
                text += para.text + "\n"

        else:
            return jsonify({"error": "Only .txt, .pdf, .docx supported"})

        return jsonify({"text": text})

    except Exception as e:
        print("Upload error:", e)
        return jsonify({"error": "Failed to process file"}), 500


if __name__ == "__main__":
    app.run(debug=True)

