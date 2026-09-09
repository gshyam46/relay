import { createDatabase } from "../src/database/database.js";
import { createServices } from "../src/api/app.js";

const db = await createDatabase(process.env.DATABASE_FILE || "data/app.db");
const services = createServices(db);

try {
  const organizationCount = (await db.get("SELECT COUNT(*) AS count FROM organizations")).count;
  if (organizationCount > 0 && !process.argv.includes("--allow-nonempty")) {
    console.error("Refusing to seed a non-empty local database.");
    console.error("Run npm.cmd run dev:reset first, or pass --allow-nonempty intentionally.");
    process.exit(1);
  }

  const organization = await services.leadsRepository.createOrganization({ name: "M2 QA Workspace" });
  const existingDuplicate = await services.leadsRepository.createLead({
    organization_id: organization.id,
    name: "Existing Duplicate",
    email: "duplicate@example.com",
    company: "Northstar Interiors",
    source: "MANUAL"
  });

  const generatedLead = await services.leadsRepository.createLead({
    organization_id: organization.id,
    name: "Generated Example",
    email: "generated@example.com",
    company: "Generated Co",
    source: "MANUAL"
  });
  await services.intelligenceService.runForLead(generatedLead);

  const incompleteLead = await services.leadsRepository.createLead({
    organization_id: organization.id,
    name: "Future Furniture",
    company: "Future Furniture",
    source: "MANUAL"
  });
  await services.intelligenceService.runForLead(incompleteLead);

  await services.leadsRepository.createLead({
    organization_id: organization.id,
    name: "Email Only",
    email: "email-only@example.com",
    source: "MANUAL"
  });
  await services.leadsRepository.createLead({
    organization_id: organization.id,
    name: "Phone Only",
    phone: "+14155551234",
    normalized_phone: "+14155551234",
    source: "MANUAL"
  });

  const preview = await services.importsService.previewCsv({
    organization_id: organization.id,
    filename: "m2-qa-leads.csv",
    csv_text:
      'Name,Email,Phone,Company,Notes\nPriya Sharma,priya@example.com,+91 98765 43210,Northstar Interiors,"Complete imported lead"\nQuoted,quoted@example.com,+91 98765 43218,"Company, With Comma","Quoted CSV parser case"\nDuplicate Import,duplicate@example.com,+91 98765 43219,Northstar Interiors,"Duplicate email warning"',
    default_phone_region: "INTERNATIONAL_ONLY"
  });
  await services.importsService.commitImport({
    import_id: preview.import.id,
    organization_id: organization.id,
    selected_row_ids: preview.rows.map((row) => row.id)
  });

  for (let index = 1; index <= 30; index += 1) {
    await services.leadsRepository.createLead({
      organization_id: organization.id,
      name: `Long Lead ${index} With A Descriptive Name`,
      email: `long.lead.${index}@example.com`,
      company: `Long Company ${index}, With Comma And Extra Text`,
      source: index % 2 === 0 ? "CSV" : "MANUAL"
    });
  }

  console.log(`Seeded ${organization.name} (${organization.id})`);
  console.log(`Included duplicate base lead ${existingDuplicate.id}`);
  console.log("Use the UI to verify not-run, generated, needs-data, duplicate, quoted CSV, and long-list states.");
} finally {
  await db.close();
}
