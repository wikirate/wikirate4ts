import API from "./wikirate-api.js";

async function main() {
    const client = new API(
        process.env.WIKIRATE_API_TOKEN || ""
    );

    const answers = await client.get_answers({
        metric_name: "Direct greenhouse gas (GHG) emissions (Scope 1), GRI 305-1-a (formerly G4-EN15-a)", 
        metric_designer: "Global Reporting Initiative",
        year: 2024, 
        limit: 20})
    console.log(answers)

      const companies = await client.get_companies(null, { limit: 1, company_identifier: '30000051696' });
      console.log(companies);

    // Add a Source from a URL
    const source = await client.add_source({
        title: "Sustainability Report 2024 (Link)",
        link: "https://report.adidas-group.com/2024/en/_assets/downloads/sustainability-statement-adidas-ar24.pdf",
        company: "Adidas AG",
        report_type: "Sustainability Report",
        year: 2024
    });

    console.log("URL source created:", source.name);

    // Call add_answer
      const answer = await client.add_answer({
        metric_designer: "Global Reporting Initiative",
        metric_name: "Direct greenhouse gas (GHG) emissions (Scope 1), GRI 305-1-a (formerly G4-EN15-a)",
        company: "Adidas AG",
        year: 2024,
        value: "20844",
        source: source.name
      });
      console.log(answer)
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});