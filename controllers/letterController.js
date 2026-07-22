import { getEmployeeLetterData } from "../services/letterRequestService.js";
import { createCanonicalLetterPdf, emailCanonicalLetter, getCanonicalLetter, renderCanonicalLetter, saveCanonicalLetter } from "../services/canonicalLetterService.js";
import { previewLetter } from "../services/previewService.js";
const userId = (req) => Number(req.user?.id || req.user?.userId);
const requirePayload = (type, body) => {
  if (type === "OFFER" && (!body.candidate_name?.trim() || !body.candidate_email?.trim() || !body.job_description?.trim())) throw Object.assign(new Error("Candidate name, email, and job description are required for an offer letter"), { statusCode: 400 });
  if (type === "EXPERIENCE_RELIEVING" && (!Number.isInteger(Number(body.employee_id)) || Number(body.employee_id) <= 0)) throw Object.assign(new Error("A valid employee is required"), { statusCode: 400 });
  if (type === "EXPERIENCE_RELIEVING" && !body.issue_date) throw Object.assign(new Error("Issue date is required"), { statusCode: 400 });
};

const fail = (res, error) => {

    console.error("================================");
    console.error("LETTER ERROR");
    console.error(error);
    console.error(error.stack);
    console.error("================================");

    return res.status(error.statusCode || 500).json({
  success: false,
  message: error.message,
  code: error.code,
  missingPlaceholders: error.missingPlaceholders,
  unknownPlaceholders: error.unknownPlaceholders,
  branch: error.branch,
});


};
const controller = {
  async get(type, _req, res) { try { const request = await getCanonicalLetter(type); if (!request) return res.status(404).json({success:false,message:"No generated letter request found"}); res.json({success:true,request}); } catch(e){ return fail(res,e); } },
 
 async preview(type, req, res) {
  try {

     console.log("========== PREVIEW BODY ==========");
    console.log(req.body);
    console.log("candidate_name =", req.body.candidate_name);
    console.log("candidate_email =", req.body.candidate_email);
    console.log("job_description =", req.body.job_description);
    console.log("=================================");



    requirePayload(type, req.body);

    let current = { ...req.body };

    if (type === "EXPERIENCE_RELIEVING") {


      const employee = await getEmployeeLetterData(
        Number(req.body.employee_id)
      );

      if (!employee) {
        throw Object.assign(
          new Error("Employee was not found"),
          { statusCode: 404 }
        );
      }

      current = {
        ...req.body,

        employee_id: employee.employee_id,
        employee_name: employee.full_name,
        full_name: employee.full_name,

        designation: employee.designation,
        department: employee.department,
        branch: employee.employee_branch,
        joining_date: employee.joining_date,

        recipient_email: employee.employee_email,
      };
    }

    const html = await previewLetter(type, current);

    res.type("html").send(html);

  } catch (e) {
    return fail(res, e);
  }
},



async generate(type, req, res) {
  try {
    console.log("========== GENERATE ==========");
    console.log("Type:", type);
    console.log("Request Body:", req.body);

    requirePayload(type, req.body);

    const id = userId(req);
    console.log("User ID:", id);

    const employee =
      type === "EXPERIENCE_RELIEVING"
        ? await getEmployeeLetterData(Number(req.body.employee_id))
        : null;

    console.log("Employee:", employee);

  console.log("Preview...");

if (type === "EXPERIENCE_RELIEVING") {
  await previewLetter(type, {
    ...req.body,
    ...employee,
    employee_id: employee.employee_id,
  });
} else {
  await previewLetter(type, req.body);
}

    console.log("=========== SAVE DATA ===========");

const saveData =
  type === "EXPERIENCE_RELIEVING"
    ? {
        ...req.body,

        employee_id: employee.employee_id,
        employee_name: employee.full_name,
        full_name: employee.full_name,

        designation: employee.designation,
        department: employee.department,
        branch: employee.employee_branch,
        joining_date: employee.joining_date,

        recipient_email: employee.employee_email,
      }
    : req.body;

    delete saveData.document_data;

console.log("req.body =", req.body);
console.log("employee =", employee);
console.log("saveData =", saveData);

console.log("================================");

const request = await saveCanonicalLetter(
  type,
  saveData,
  id
);




    console.log("Saved:", request);

    res.status(201).json({
      success: true,
      request,
    });

  } catch (e) {
    console.error(e);
    return fail(res, e);
  }
},
 
  async download(type, _req, res)
   { try {
     const pdf=await createCanonicalLetterPdf(type);
      res.set({"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${type.toLowerCase()}-letter.pdf"`,"Content-Length":pdf.length}).send(pdf); } 
      
      catch(e){ return fail(res,e);
        
       } },



  async sendEmail(type, req, res) { try { await emailCanonicalLetter(type, { to: req.body.recipient_email, subject: req.body.subject, text: req.body.message, userId: userId(req) }); res.json({success:true}); } catch(e){ return fail(res,e); } },
};
export default controller;
