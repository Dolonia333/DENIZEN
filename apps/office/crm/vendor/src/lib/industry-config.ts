// Industry configuration system: templates, terminology, custom fields, and pipeline stages

export interface IndustryTerminology {
  contact: string;
  contacts: string;
  deal: string;
  deals: string;
  pipeline: string;
  company: string;
  account: string;
  accounts: string;
  customers: string;
  salesHub: string;
  pipelineValue: string;
  note: string;
  notes: string;
  task: string;
  tasks: string;
  value: string;
  closeDate: string;
  stage: string;
}

export interface CustomFieldDef {
  id: string;
  label: string;
  type: "text" | "number" | "select" | "date" | "checkbox" | "url" | "email" | "textarea";
  entity: "contact" | "deal";
  options?: string[];
  required?: boolean;
}

export interface IndustryConfig {
  id: string;
  /** Salesforce-style vertical profile key (defaults to `id`) */
  industry?: string;
  name: string;
  icon: string;
  terminology: IndustryTerminology;
  pipelineStages: string[];
  customFields: CustomFieldDef[];
  contactStatuses: string[];
  noteTypes: string[];
}

const DEFAULT_TERMINOLOGY: IndustryTerminology = {
  contact: "Contact", contacts: "Contacts", deal: "Deal", deals: "Deals",
  pipeline: "Pipeline", company: "Company", account: "Account", accounts: "Accounts",
  customers: "Customers", salesHub: "Sales Hub", pipelineValue: "Pipeline Value",
  note: "Note", notes: "Notes", task: "Task", tasks: "Tasks",
  value: "Value", closeDate: "Close Date", stage: "Stage",
};

function withDefaults(partial: Partial<IndustryTerminology>): IndustryTerminology {
  return { ...DEFAULT_TERMINOLOGY, ...partial };
}

export const INDUSTRY_TEMPLATES: IndustryConfig[] = [
  {
    id: "sales", name: "B2B Sales", icon: "💼", industry: "sales",
    terminology: withDefaults({}),
    pipelineStages: ["Lead", "Qualified", "Proposal", "Negotiation", "Closed Won", "Closed Lost"],
    customFields: [
      { id: "arr", label: "ARR", type: "number", entity: "deal" },
      { id: "mrr", label: "MRR", type: "number", entity: "deal" },
      { id: "contract_length", label: "Contract Length", type: "select", entity: "deal", options: ["Monthly", "Annual", "2-Year", "3-Year"] },
    ],
    contactStatuses: ["Lead", "Prospect", "Customer"],
    noteTypes: ["Call", "Email", "Meeting"],
  },
  {
    id: "saas", name: "Software as a Service (SaaS)", icon: "☁️", industry: "saas",
    terminology: withDefaults({
      contact: "User", contacts: "Users", deal: "Subscription", deals: "Subscriptions",
      pipeline: "Revenue Pipeline", account: "Tenant", accounts: "Tenants",
      customers: "Subscribers", salesHub: "Growth Hub", pipelineValue: "ARR Pipeline",
      value: "ARR", closeDate: "Contract Start", stage: "Lifecycle Stage",
    }),
    pipelineStages: ["Lead", "MQL", "SQL", "Demo", "Trial", "Proposal", "Negotiation", "Closed Won", "Closed Lost", "Churn Risk"],
    customFields: [
      { id: "arr", label: "ARR", type: "number", entity: "deal" },
      { id: "mrr", label: "MRR", type: "number", entity: "deal" },
      { id: "seats", label: "Seats / Licenses", type: "number", entity: "deal" },
      { id: "plan_tier", label: "Plan Tier", type: "select", entity: "deal", options: ["Free", "Starter", "Pro", "Business", "Enterprise"] },
      { id: "trial_end", label: "Trial End Date", type: "date", entity: "deal" },
      { id: "ndr", label: "NDR %", type: "number", entity: "deal" },
      { id: "expansion", label: "Expansion Opportunity", type: "checkbox", entity: "deal" },
      { id: "churn_risk", label: "Churn Risk", type: "select", entity: "contact", options: ["Low", "Medium", "High"] },
      { id: "product_usage", label: "Product Usage Score", type: "number", entity: "contact" },
    ],
    contactStatuses: ["Trial", "Active", "Expansion", "At-Risk", "Churned"],
    noteTypes: ["Demo", "Onboarding", "QBR", "Call", "Email", "Support Escalation"],
  },
  {
    id: "iaas", name: "Infrastructure as a Service (IaaS)", icon: "🖥️", industry: "iaas",
    terminology: withDefaults({
      contact: "Technical Contact", contacts: "Technical Contacts", deal: "Workload", deals: "Workloads",
      pipeline: "Capacity Pipeline", account: "Tenant", accounts: "Tenants",
      customers: "Customers", salesHub: "Cloud Sales Hub", pipelineValue: "Committed Spend",
      value: "Monthly Spend", closeDate: "Go-Live Date", stage: "Stage",
    }),
    pipelineStages: ["Inquiry", "Architecture Review", "POC", "Sizing", "Proposal", "Contract", "Provisioned", "Active", "Churned"],
    customFields: [
      { id: "workload_type", label: "Workload Type", type: "select", entity: "deal", options: ["Compute", "Storage", "Network", "Kubernetes", "Hybrid", "DR/Backup"] },
      { id: "monthly_spend", label: "Est. Monthly Spend", type: "number", entity: "deal" },
      { id: "instance_count", label: "Instance / Node Count", type: "number", entity: "deal" },
      { id: "region", label: "Primary Region", type: "select", entity: "deal", options: ["US-East", "US-West", "EU", "APAC", "GovCloud", "Multi-Region"] },
      { id: "sla_tier", label: "SLA Tier", type: "select", entity: "deal", options: ["Standard", "Business", "Premium", "Mission Critical"] },
      { id: "compliance", label: "Compliance Needs", type: "select", entity: "deal", options: ["SOC 2", "HIPAA", "FedRAMP", "PCI", "ISO 27001", "None"] },
      { id: "reserved_commit", label: "Reserved Commitment", type: "checkbox", entity: "deal" },
    ],
    contactStatuses: ["Prospect", "POC", "Active Customer", "Expansion", "Churned"],
    noteTypes: ["Architecture Review", "POC", "Call", "Email", "Capacity Planning", "Incident Review"],
  },
  {
    id: "govcon", name: "Government Contracting", icon: "🏛️", industry: "govcon",
    terminology: withDefaults({
      contact: "Stakeholder", contacts: "Stakeholders", deal: "Opportunity", deals: "Opportunities",
      pipeline: "Capture Pipeline", account: "Agency", accounts: "Agencies",
      customers: "Contracting Officers", salesHub: "Capture Hub", pipelineValue: "Pipeline Value",
      value: "Contract Value", closeDate: "Award Date", stage: "Phase",
      company: "Prime / Sub",
    }),
    pipelineStages: ["Market Research", "Capture", "Pre-RFP", "RFP Released", "Proposal", "Submitted", "Awarded", "Lost", "Protest"],
    customFields: [
      { id: "naics", label: "NAICS Code", type: "text", entity: "deal" },
      { id: "contract_vehicle", label: "Contract Vehicle", type: "select", entity: "deal", options: ["GSA Schedule", "SEWP", "CIO-SP3", "OASIS", "Alliant", "SBIR", "IDIQ", "BPA", "Direct Award"] },
      { id: "set_aside", label: "Set-Aside", type: "select", entity: "deal", options: ["Full & Open", "8(a)", "HUBZone", "SDVOSB", "WOSB", "Small Business"] },
      { id: "clearance", label: "Clearance Required", type: "select", entity: "deal", options: ["None", "Public Trust", "Secret", "Top Secret", "TS/SCI"] },
      { id: "pop_start", label: "Period of Performance Start", type: "date", entity: "deal" },
      { id: "pop_end", label: "Period of Performance End", type: "date", entity: "deal" },
      { id: "contract_type", label: "Contract Type", type: "select", entity: "deal", options: ["FFP", "T&M", "Cost-Plus", "CPFF", "CPAF", "IDIQ Task Order"] },
      { id: "solicitation", label: "Solicitation #", type: "text", entity: "deal" },
      { id: "incumbent", label: "Incumbent", type: "text", entity: "deal" },
    ],
    contactStatuses: ["Prospect", "Capture Team", "Proposal Team", "Past Performance", "Inactive"],
    noteTypes: ["Capture Meeting", "Industry Day", "Call", "Email", "Proposal Review", "Debrief"],
  },
  {
    id: "real-estate", name: "Real Estate", icon: "🏠",
    terminology: withDefaults({
      contact: "Client", contacts: "Clients", deal: "Listing", deals: "Listings",
      pipeline: "Pipeline", company: "Agency", account: "Agency", accounts: "Agencies",
      customers: "Clients", salesHub: "Deals Hub", pipelineValue: "Portfolio Value",
      note: "Note", notes: "Notes",
      task: "Task", tasks: "Tasks", value: "Price", closeDate: "Closing Date", stage: "Status",
    }),
    pipelineStages: ["New Lead", "Showing Scheduled", "Offer Made", "Under Contract", "Inspection", "Closed", "Lost"],
    customFields: [
      { id: "property_type", label: "Property Type", type: "select", entity: "deal", options: ["Single Family", "Condo", "Townhouse", "Multi-Family", "Commercial", "Land"] },
      { id: "bedrooms", label: "Bedrooms", type: "number", entity: "deal" },
      { id: "sqft", label: "Square Feet", type: "number", entity: "deal" },
      { id: "mls_number", label: "MLS #", type: "text", entity: "deal" },
      { id: "address", label: "Property Address", type: "text", entity: "deal" },
      { id: "buyer_seller", label: "Buyer/Seller", type: "select", entity: "contact", options: ["Buyer", "Seller", "Both", "Investor"] },
      { id: "pre_approved", label: "Pre-Approved", type: "checkbox", entity: "contact" },
    ],
    contactStatuses: ["New Lead", "Active Buyer", "Active Seller", "Under Contract", "Past Client"],
    noteTypes: ["Showing", "Call", "Email", "Inspection", "Open House"],
  },
  {
    id: "legal", name: "Legal / Law Firm", icon: "⚖️",
    terminology: withDefaults({
      contact: "Client", contacts: "Clients", deal: "Case", deals: "Cases",
      pipeline: "Case Pipeline", company: "Firm", account: "Client", accounts: "Clients",
      customers: "Clients", salesHub: "Case Hub", pipelineValue: "Case Value",
      note: "Note", notes: "Notes",
      task: "Task", tasks: "Tasks", value: "Fee", closeDate: "Resolution Date", stage: "Phase",
    }),
    pipelineStages: ["Intake", "Consultation", "Active", "Discovery", "Negotiation", "Trial", "Resolved", "Closed"],
    customFields: [
      { id: "case_number", label: "Case Number", type: "text", entity: "deal" },
      { id: "case_type", label: "Case Type", type: "select", entity: "deal", options: ["Civil", "Criminal", "Family", "Corporate", "IP", "Real Estate", "Immigration"] },
      { id: "court", label: "Court/Jurisdiction", type: "text", entity: "deal" },
      { id: "opposing_counsel", label: "Opposing Counsel", type: "text", entity: "deal" },
      { id: "retainer_paid", label: "Retainer Paid", type: "checkbox", entity: "contact" },
      { id: "referral_source", label: "Referral Source", type: "text", entity: "contact" },
    ],
    contactStatuses: ["Prospect", "Active Client", "Retained", "Past Client"],
    noteTypes: ["Consultation", "Court Appearance", "Call", "Email", "Filing"],
  },
  {
    id: "healthcare", name: "Healthcare & Life Sciences", icon: "🏥",
    terminology: withDefaults({
      contact: "Patient", contacts: "Patients", deal: "Treatment Plan", deals: "Treatment Plans",
      pipeline: "Treatments & Care Plans", company: "Practice", account: "Medical Facility", accounts: "Medical Facilities",
      customers: "Patients", salesHub: "Care Hub", pipelineValue: "Care Plan Value",
      value: "Est. Revenue", closeDate: "Target Date", stage: "Status",
    }),
    pipelineStages: ["Inquiry", "Consultation", "Treatment Plan", "Scheduled", "In Treatment", "Completed", "Follow-Up"],
    customFields: [
      { id: "insurance", label: "Insurance Provider", type: "text", entity: "contact" },
      { id: "dob", label: "Date of Birth", type: "date", entity: "contact" },
      { id: "primary_physician", label: "Primary Physician", type: "text", entity: "contact" },
      { id: "treatment_type", label: "Treatment Type", type: "text", entity: "deal" },
      { id: "insurance_verified", label: "Insurance Verified", type: "checkbox", entity: "deal" },
    ],
    contactStatuses: ["Inquiry", "New Patient", "Active Patient", "Follow-Up", "Inactive"],
    noteTypes: ["Consultation", "Follow-Up", "Call", "Email", "Referral"],
  },
  {
    id: "consulting", name: "Consulting", icon: "📊",
    terminology: withDefaults({
      contact: "Client", contacts: "Clients", deal: "Project", deals: "Projects",
      pipeline: "Project Pipeline", company: "Organization", account: "Client", accounts: "Clients",
      customers: "Clients", salesHub: "Project Hub", pipelineValue: "Project Value",
      note: "Note", notes: "Notes",
      task: "Task", tasks: "Tasks", value: "Budget", closeDate: "Deadline", stage: "Phase",
    }),
    pipelineStages: ["Lead", "Discovery", "Proposal", "SOW Sent", "Active", "Delivery", "Completed", "Lost"],
    customFields: [
      { id: "project_type", label: "Project Type", type: "select", entity: "deal", options: ["Strategy", "Implementation", "Audit", "Training", "Advisory", "Fractional"] },
      { id: "hours_estimated", label: "Est. Hours", type: "number", entity: "deal" },
      { id: "hourly_rate", label: "Hourly Rate", type: "number", entity: "deal" },
      { id: "department", label: "Department", type: "text", entity: "contact" },
      { id: "decision_maker", label: "Decision Maker", type: "checkbox", entity: "contact" },
    ],
    contactStatuses: ["Lead", "Prospect", "Active Client", "Past Client"],
    noteTypes: ["Call", "Email", "Meeting", "Workshop", "Deliverable"],
  },
  {
    id: "education", name: "Education", icon: "🎓",
    terminology: withDefaults({
      contact: "Student", contacts: "Students", deal: "Enrollment", deals: "Enrollments",
      pipeline: "Admissions Pipeline", company: "Institution", account: "Institution", accounts: "Institutions",
      customers: "Students", salesHub: "Admissions Hub", pipelineValue: "Tuition Pipeline",
      note: "Note", notes: "Notes",
      task: "Task", tasks: "Tasks", value: "Tuition", closeDate: "Start Date", stage: "Status",
    }),
    pipelineStages: ["Inquiry", "Application", "Review", "Accepted", "Enrolled", "Deferred", "Declined"],
    customFields: [
      { id: "program", label: "Program", type: "text", entity: "deal" },
      { id: "gpa", label: "GPA", type: "number", entity: "contact" },
      { id: "graduation_year", label: "Graduation Year", type: "number", entity: "contact" },
      { id: "financial_aid", label: "Financial Aid", type: "checkbox", entity: "deal" },
      { id: "scholarship", label: "Scholarship Amount", type: "number", entity: "deal" },
    ],
    contactStatuses: ["Inquiry", "Applicant", "Accepted", "Enrolled", "Alumni"],
    noteTypes: ["Inquiry", "Interview", "Call", "Email", "Campus Visit"],
  },
  {
    id: "recruitment", name: "Recruitment / HR", icon: "👔",
    terminology: withDefaults({
      contact: "Candidate", contacts: "Candidates", deal: "Placement", deals: "Placements",
      pipeline: "Hiring Pipeline", company: "Client Company", account: "Client Company", accounts: "Client Companies",
      customers: "Clients", salesHub: "Hiring Hub", pipelineValue: "Placement Pipeline",
      note: "Note", notes: "Notes",
      task: "Task", tasks: "Tasks", value: "Placement Fee", closeDate: "Start Date", stage: "Status",
    }),
    pipelineStages: ["Sourced", "Screen", "Interview", "Technical", "Offer", "Placed", "Rejected"],
    customFields: [
      { id: "role_title", label: "Role Title", type: "text", entity: "deal" },
      { id: "salary_range", label: "Salary Range", type: "text", entity: "deal" },
      { id: "experience_years", label: "Years of Experience", type: "number", entity: "contact" },
      { id: "linkedin", label: "LinkedIn URL", type: "url", entity: "contact" },
      { id: "resume_url", label: "Resume URL", type: "url", entity: "contact" },
      { id: "skills", label: "Key Skills", type: "textarea", entity: "contact" },
    ],
    contactStatuses: ["Sourced", "Active Candidate", "Placed", "Not a Fit", "Passive"],
    noteTypes: ["Screen Call", "Interview", "Email", "Reference Check", "Offer Discussion"],
  },
  {
    id: "media", name: "Photography / Video / Media", icon: "📸",
    terminology: withDefaults({
      contact: "Client", contacts: "Clients", deal: "Project", deals: "Projects",
      pipeline: "Production Pipeline", company: "Studio", account: "Client", accounts: "Clients",
      customers: "Clients", salesHub: "Production Hub", pipelineValue: "Booking Value",
      note: "Note", notes: "Notes",
      task: "Task", tasks: "Tasks", value: "Quote", closeDate: "Delivery Date", stage: "Phase",
    }),
    pipelineStages: ["Inquiry", "Consultation", "Booked", "Pre-Production", "Shoot/Film", "Editing", "Review", "Delivered", "Lost"],
    customFields: [
      { id: "project_type", label: "Project Type", type: "select", entity: "deal", options: ["Wedding", "Portrait", "Commercial", "Event", "Product", "Real Estate", "Music Video", "Corporate Video", "Documentary", "Social Media Content"] },
      { id: "shoot_date", label: "Shoot Date", type: "date", entity: "deal" },
      { id: "location", label: "Location", type: "text", entity: "deal" },
      { id: "deliverables", label: "Deliverables", type: "textarea", entity: "deal" },
      { id: "hours_booked", label: "Hours Booked", type: "number", entity: "deal" },
      { id: "second_shooter", label: "Second Shooter Needed", type: "checkbox", entity: "deal" },
      { id: "referral_source", label: "Referral Source", type: "text", entity: "contact" },
      { id: "social_handle", label: "Social Media Handle", type: "text", entity: "contact" },
    ],
    contactStatuses: ["Inquiry", "Booked", "Active Client", "Past Client", "Referral Partner"],
    noteTypes: ["Consultation", "Call", "Email", "Shoot Notes", "Edit Feedback", "Delivery"],
  },
  {
    id: "financial-services", name: "Financial Services", icon: "🏦", industry: "financial-services",
    terminology: withDefaults({
      contact: "Client", contacts: "Clients", deal: "Portfolio", deals: "Portfolios",
      pipeline: "Portfolio Pipeline", account: "Household", accounts: "Households",
      customers: "Clients", salesHub: "Wealth Hub", pipelineValue: "Assets Under Management",
      company: "Firm", value: "AUM", closeDate: "Review Date",
    }),
    pipelineStages: ["Prospect", "Discovery", "Proposal", "Onboarding", "Active", "Closed Lost"],
    customFields: [
      { id: "risk_profile", label: "Risk Profile", type: "select", entity: "contact", options: ["Conservative", "Moderate", "Aggressive"] },
      { id: "aum", label: "AUM", type: "number", entity: "deal" },
    ],
    contactStatuses: ["Prospect", "Client", "High Net Worth", "Inactive"],
    noteTypes: ["Call", "Email", "Meeting", "Review"],
  },
  {
    id: "nonprofit", name: "Nonprofit", icon: "💚", industry: "nonprofit",
    terminology: withDefaults({
      contact: "Donor", contacts: "Donors", deal: "Donation", deals: "Donations & Grants",
      pipeline: "Donations & Grants", account: "Program", accounts: "Programs",
      customers: "Donors", salesHub: "Fundraising Hub", pipelineValue: "Funding Targets",
      company: "Organization", value: "Gift Amount", closeDate: "Pledge Date",
    }),
    pipelineStages: ["Inquiry", "Cultivation", "Ask", "Pledged", "Received", "Stewardship", "Declined"],
    customFields: [
      { id: "gift_type", label: "Gift Type", type: "select", entity: "deal", options: ["One-Time", "Recurring", "Grant", "In-Kind"] },
      { id: "campaign", label: "Campaign", type: "text", entity: "deal" },
    ],
    contactStatuses: ["Prospect", "Donor", "Major Donor", "Lapsed"],
    noteTypes: ["Call", "Email", "Event", "Thank You"],
  },
  {
    id: "manufacturing", name: "Manufacturing", icon: "🏭", industry: "manufacturing",
    terminology: withDefaults({
      contact: "Buyer", contacts: "Buyers", deal: "Order", deals: "Orders",
      pipeline: "Order Pipeline", account: "Plant", accounts: "Plants",
      company: "Manufacturer", pipelineValue: "Order Backlog",
    }),
    pipelineStages: ["RFQ", "Quote", "PO Received", "Production", "Shipped", "Closed Won", "Closed Lost"],
    customFields: [
      { id: "sku", label: "SKU", type: "text", entity: "deal" },
      { id: "lead_time", label: "Lead Time (days)", type: "number", entity: "deal" },
    ],
    contactStatuses: ["Lead", "Qualified", "Customer", "Inactive"],
    noteTypes: ["Call", "Email", "Site Visit", "Quote"],
  },
  {
    id: "retail", name: "Retail", icon: "🛍️", industry: "retail",
    terminology: withDefaults({
      contact: "Shopper", contacts: "Shoppers", deal: "Sale", deals: "Sales",
      pipeline: "Sales Pipeline", account: "Store", accounts: "Stores",
      customers: "Shoppers", pipelineValue: "Sales Target", company: "Retailer",
    }),
    pipelineStages: ["Browse", "Cart", "Checkout", "Fulfilled", "Returned", "Lost"],
    customFields: [
      { id: "loyalty_tier", label: "Loyalty Tier", type: "select", entity: "contact", options: ["Bronze", "Silver", "Gold", "Platinum"] },
      { id: "basket_size", label: "Avg Basket", type: "number", entity: "contact" },
    ],
    contactStatuses: ["Lead", "Member", "VIP", "Churned"],
    noteTypes: ["Call", "Email", "In-Store", "Support"],
  },
  {
    id: "insurance", name: "Insurance", icon: "🛡️", industry: "insurance",
    terminology: withDefaults({
      contact: "Policyholder", contacts: "Policyholders", deal: "Policy", deals: "Policies",
      pipeline: "Quote Pipeline", company: "Carrier", account: "Household", accounts: "Households",
      customers: "Policyholders", salesHub: "Book of Business", pipelineValue: "Premium Pipeline",
      value: "Premium", closeDate: "Effective Date", stage: "Status",
    }),
    pipelineStages: ["Lead", "Quoted", "Application", "Underwriting", "Bound", "Renewal", "Lapsed"],
    customFields: [
      { id: "policy_type", label: "Policy Type", type: "select", entity: "deal", options: ["Auto", "Home", "Life", "Health", "Commercial", "Umbrella"] },
      { id: "premium", label: "Annual Premium", type: "number", entity: "deal" },
      { id: "renewal_date", label: "Renewal Date", type: "date", entity: "deal" },
    ],
    contactStatuses: ["Lead", "Quoted", "Active Policy", "Lapsed"],
    noteTypes: ["Call", "Email", "Quote", "Claim", "Review"],
  },
  {
    id: "automotive", name: "Automotive / Dealership", icon: "🚗", industry: "automotive",
    terminology: withDefaults({
      contact: "Buyer", contacts: "Buyers", deal: "Vehicle Sale", deals: "Vehicle Sales",
      pipeline: "Sales Pipeline", company: "Dealership", account: "Dealership", accounts: "Dealerships",
      customers: "Buyers", salesHub: "Showroom", pipelineValue: "Sales Pipeline",
      value: "Sale Price", closeDate: "Delivery Date", stage: "Status",
    }),
    pipelineStages: ["Inquiry", "Test Drive", "Negotiation", "Financing", "Sold", "Delivered", "Lost"],
    customFields: [
      { id: "vehicle", label: "Vehicle", type: "text", entity: "deal" },
      { id: "trade_in", label: "Trade-In", type: "checkbox", entity: "deal" },
      { id: "financing", label: "Financing", type: "select", entity: "deal", options: ["Cash", "Loan", "Lease"] },
    ],
    contactStatuses: ["Lead", "Test Drive", "Customer", "Service Only"],
    noteTypes: ["Call", "Email", "Test Drive", "Service", "Follow-Up"],
  },
  {
    id: "construction", name: "Construction / Contracting", icon: "🏗️", industry: "construction",
    terminology: withDefaults({
      contact: "Client", contacts: "Clients", deal: "Project", deals: "Projects",
      pipeline: "Bid Pipeline", company: "GC / Builder", account: "Client", accounts: "Clients",
      customers: "Clients", salesHub: "Bid Hub", pipelineValue: "Backlog Value",
      value: "Contract Value", closeDate: "Start Date", stage: "Phase",
    }),
    pipelineStages: ["Lead", "Site Visit", "Estimate", "Bid Submitted", "Awarded", "In Progress", "Completed", "Lost"],
    customFields: [
      { id: "project_type", label: "Project Type", type: "select", entity: "deal", options: ["Residential", "Commercial", "Remodel", "New Build", "Repair"] },
      { id: "sqft", label: "Square Feet", type: "number", entity: "deal" },
      { id: "permit", label: "Permit Required", type: "checkbox", entity: "deal" },
    ],
    contactStatuses: ["Lead", "Bidding", "Active Client", "Past Client"],
    noteTypes: ["Site Visit", "Call", "Email", "Estimate", "Change Order"],
  },
  {
    id: "hospitality", name: "Hospitality / Hotels", icon: "🏨", industry: "hospitality",
    terminology: withDefaults({
      contact: "Guest", contacts: "Guests", deal: "Booking", deals: "Bookings",
      pipeline: "Reservations", company: "Property", account: "Property", accounts: "Properties",
      customers: "Guests", salesHub: "Reservations Hub", pipelineValue: "Booking Revenue",
      value: "Booking Value", closeDate: "Check-In", stage: "Status",
    }),
    pipelineStages: ["Inquiry", "Quote Sent", "Tentative", "Confirmed", "Checked In", "Completed", "Cancelled"],
    customFields: [
      { id: "room_type", label: "Room/Package", type: "text", entity: "deal" },
      { id: "guests", label: "Party Size", type: "number", entity: "deal" },
      { id: "event", label: "Event Booking", type: "checkbox", entity: "deal" },
    ],
    contactStatuses: ["Inquiry", "Booked", "Repeat Guest", "VIP"],
    noteTypes: ["Call", "Email", "Site Tour", "Event", "Follow-Up"],
  },
  {
    id: "fitness", name: "Fitness / Wellness", icon: "💪", industry: "fitness",
    terminology: withDefaults({
      contact: "Member", contacts: "Members", deal: "Membership", deals: "Memberships",
      pipeline: "Membership Pipeline", company: "Studio / Gym", account: "Location", accounts: "Locations",
      customers: "Members", salesHub: "Membership Hub", pipelineValue: "Membership Revenue",
      value: "Plan Value", closeDate: "Start Date", stage: "Status",
    }),
    pipelineStages: ["Lead", "Trial", "Tour", "Joined", "Active", "Renewed", "Cancelled"],
    customFields: [
      { id: "plan", label: "Plan", type: "select", entity: "deal", options: ["Monthly", "Annual", "Class Pack", "Personal Training"] },
      { id: "goal", label: "Fitness Goal", type: "text", entity: "contact" },
    ],
    contactStatuses: ["Lead", "Trial", "Active Member", "Frozen", "Cancelled"],
    noteTypes: ["Call", "Email", "Tour", "Check-In", "Renewal"],
  },
  {
    id: "travel", name: "Travel / Tourism", icon: "✈️", industry: "travel",
    terminology: withDefaults({
      contact: "Traveler", contacts: "Travelers", deal: "Trip", deals: "Trips",
      pipeline: "Booking Pipeline", company: "Agency", account: "Account", accounts: "Accounts",
      customers: "Travelers", salesHub: "Trips Hub", pipelineValue: "Booking Value",
      value: "Trip Value", closeDate: "Departure Date", stage: "Status",
    }),
    pipelineStages: ["Inquiry", "Itinerary Sent", "Quoted", "Booked", "Traveling", "Completed", "Cancelled"],
    customFields: [
      { id: "destination", label: "Destination", type: "text", entity: "deal" },
      { id: "party_size", label: "Party Size", type: "number", entity: "deal" },
      { id: "trip_type", label: "Trip Type", type: "select", entity: "deal", options: ["Leisure", "Business", "Honeymoon", "Group", "Cruise"] },
    ],
    contactStatuses: ["Inquiry", "Booked", "Repeat Client", "VIP"],
    noteTypes: ["Call", "Email", "Itinerary", "Booking", "Follow-Up"],
  },
  {
    id: "home-services", name: "Home Services (HVAC / Plumbing)", icon: "🔧", industry: "home-services",
    terminology: withDefaults({
      contact: "Customer", contacts: "Customers", deal: "Job", deals: "Jobs",
      pipeline: "Job Pipeline", company: "Service Co", account: "Property", accounts: "Properties",
      customers: "Customers", salesHub: "Dispatch Hub", pipelineValue: "Job Pipeline",
      value: "Job Value", closeDate: "Service Date", stage: "Status",
    }),
    pipelineStages: ["Lead", "Estimate", "Scheduled", "In Progress", "Completed", "Invoiced", "Lost"],
    customFields: [
      { id: "service_type", label: "Service Type", type: "select", entity: "deal", options: ["HVAC", "Plumbing", "Electrical", "Roofing", "General Repair"] },
      { id: "warranty", label: "Under Warranty", type: "checkbox", entity: "deal" },
      { id: "recurring", label: "Maintenance Plan", type: "checkbox", entity: "contact" },
    ],
    contactStatuses: ["Lead", "Scheduled", "Active Customer", "Maintenance Plan"],
    noteTypes: ["Call", "Email", "Estimate", "Service Visit", "Follow-Up"],
  },
  {
    id: "accounting", name: "Accounting / Tax", icon: "📒", industry: "accounting",
    terminology: withDefaults({
      contact: "Client", contacts: "Clients", deal: "Engagement", deals: "Engagements",
      pipeline: "Engagement Pipeline", company: "Firm", account: "Client", accounts: "Clients",
      customers: "Clients", salesHub: "Engagements Hub", pipelineValue: "Fee Pipeline",
      value: "Fee", closeDate: "Deadline", stage: "Status",
    }),
    pipelineStages: ["Lead", "Consultation", "Proposal", "Engaged", "In Progress", "Filed", "Renewed"],
    customFields: [
      { id: "service", label: "Service", type: "select", entity: "deal", options: ["Tax Prep", "Bookkeeping", "Audit", "Advisory", "Payroll"] },
      { id: "entity_type", label: "Entity Type", type: "select", entity: "contact", options: ["Individual", "LLC", "S-Corp", "C-Corp", "Nonprofit"] },
    ],
    contactStatuses: ["Lead", "Prospect", "Active Client", "Seasonal", "Past Client"],
    noteTypes: ["Call", "Email", "Meeting", "Document Request", "Filing"],
  },
  {
    id: "beauty", name: "Beauty / Salon / Spa", icon: "💅", industry: "beauty",
    terminology: withDefaults({
      contact: "Client", contacts: "Clients", deal: "Appointment", deals: "Appointments",
      pipeline: "Booking Pipeline", company: "Salon / Spa", account: "Location", accounts: "Locations",
      customers: "Clients", salesHub: "Bookings Hub", pipelineValue: "Service Revenue",
      value: "Service Value", closeDate: "Appointment Date", stage: "Status",
    }),
    pipelineStages: ["Inquiry", "Booked", "Confirmed", "Completed", "Rebooked", "No-Show", "Cancelled"],
    customFields: [
      { id: "service", label: "Service", type: "text", entity: "deal" },
      { id: "stylist", label: "Stylist / Provider", type: "text", entity: "deal" },
    ],
    contactStatuses: ["New", "Regular", "VIP", "Lapsed"],
    noteTypes: ["Call", "Email", "Appointment", "Consultation", "Follow-Up"],
  },
  {
    id: "events", name: "Event Planning", icon: "🎉", industry: "events",
    terminology: withDefaults({
      contact: "Client", contacts: "Clients", deal: "Event", deals: "Events",
      pipeline: "Event Pipeline", company: "Venue / Planner", account: "Client", accounts: "Clients",
      customers: "Clients", salesHub: "Events Hub", pipelineValue: "Event Revenue",
      value: "Event Budget", closeDate: "Event Date", stage: "Status",
    }),
    pipelineStages: ["Inquiry", "Proposal", "Booked", "Planning", "Executed", "Completed", "Cancelled"],
    customFields: [
      { id: "event_type", label: "Event Type", type: "select", entity: "deal", options: ["Wedding", "Corporate", "Birthday", "Conference", "Fundraiser"] },
      { id: "headcount", label: "Headcount", type: "number", entity: "deal" },
      { id: "venue", label: "Venue", type: "text", entity: "deal" },
    ],
    contactStatuses: ["Inquiry", "Booked", "Past Client", "Referral Partner"],
    noteTypes: ["Call", "Email", "Site Visit", "Planning Meeting", "Vendor"],
  },
  {
    id: "logistics", name: "Logistics / Freight", icon: "🚚", industry: "logistics",
    terminology: withDefaults({
      contact: "Shipper", contacts: "Shippers", deal: "Contract", deals: "Contracts",
      pipeline: "Freight Pipeline", company: "Carrier / 3PL", account: "Account", accounts: "Accounts",
      customers: "Shippers", salesHub: "Freight Hub", pipelineValue: "Freight Revenue",
      value: "Contract Value", closeDate: "Start Date", stage: "Status",
    }),
    pipelineStages: ["Lead", "Quote", "Contract", "Booked", "In Transit", "Delivered", "Lost"],
    customFields: [
      { id: "mode", label: "Mode", type: "select", entity: "deal", options: ["FTL", "LTL", "Air", "Ocean", "Intermodal"] },
      { id: "lane", label: "Lane", type: "text", entity: "deal" },
    ],
    contactStatuses: ["Lead", "Quoted", "Active Account", "Inactive"],
    noteTypes: ["Call", "Email", "Quote", "Dispatch", "Review"],
  },
  {
    id: "agency", name: "Marketing / Creative Agency", icon: "📈", industry: "agency",
    terminology: withDefaults({
      contact: "Client", contacts: "Clients", deal: "Retainer", deals: "Retainers",
      pipeline: "New Business", company: "Brand", account: "Client", accounts: "Clients",
      customers: "Clients", salesHub: "New Business Hub", pipelineValue: "Retainer Pipeline",
      value: "Retainer Value", closeDate: "Kickoff Date", stage: "Stage",
    }),
    pipelineStages: ["Lead", "Discovery", "Pitch", "Proposal", "Won", "Active", "Churned"],
    customFields: [
      { id: "service", label: "Service", type: "select", entity: "deal", options: ["SEO", "Paid Media", "Branding", "Web", "Social", "Content", "Full Service"] },
      { id: "monthly_retainer", label: "Monthly Retainer", type: "number", entity: "deal" },
    ],
    contactStatuses: ["Lead", "Prospect", "Active Client", "Past Client"],
    noteTypes: ["Call", "Email", "Pitch", "Kickoff", "Review"],
  },
  {
    id: "dental", name: "Dental Practice", icon: "🦷", industry: "dental",
    terminology: withDefaults({
      contact: "Patient", contacts: "Patients", deal: "Treatment Plan", deals: "Treatment Plans",
      pipeline: "Treatment Pipeline", company: "Practice", account: "Practice", accounts: "Practices",
      customers: "Patients", salesHub: "Treatment Hub", pipelineValue: "Treatment Value",
      value: "Plan Value", closeDate: "Target Date", stage: "Status",
    }),
    pipelineStages: ["New Patient", "Consultation", "Treatment Plan", "Scheduled", "In Treatment", "Completed", "Recall"],
    customFields: [
      { id: "treatment", label: "Treatment", type: "select", entity: "deal", options: ["Cleaning", "Filling", "Crown", "Implant", "Ortho", "Cosmetic"] },
      { id: "insurance", label: "Insurance Provider", type: "text", entity: "contact" },
    ],
    contactStatuses: ["New Patient", "Active Patient", "Recall Due", "Inactive"],
    noteTypes: ["Consultation", "Call", "Email", "Appointment", "Recall"],
  },
  {
    id: "solar", name: "Solar / Renewable Energy", icon: "☀️", industry: "solar",
    terminology: withDefaults({
      contact: "Homeowner", contacts: "Homeowners", deal: "Installation", deals: "Installations",
      pipeline: "Install Pipeline", company: "Installer", account: "Property", accounts: "Properties",
      customers: "Homeowners", salesHub: "Install Hub", pipelineValue: "Install Pipeline",
      value: "System Price", closeDate: "Install Date", stage: "Status",
    }),
    pipelineStages: ["Lead", "Site Survey", "Proposal", "Signed", "Permitting", "Installed", "Activated", "Lost"],
    customFields: [
      { id: "system_size", label: "System Size (kW)", type: "number", entity: "deal" },
      { id: "financing", label: "Financing", type: "select", entity: "deal", options: ["Cash", "Loan", "Lease", "PPA"] },
      { id: "roof_type", label: "Roof Type", type: "text", entity: "deal" },
    ],
    contactStatuses: ["Lead", "Surveyed", "Customer", "Not Qualified"],
    noteTypes: ["Call", "Email", "Site Survey", "Proposal", "Install"],
  },
  {
    id: "veterinary", name: "Veterinary", icon: "🐾", industry: "veterinary",
    terminology: withDefaults({
      contact: "Pet Owner", contacts: "Pet Owners", deal: "Treatment", deals: "Treatments",
      pipeline: "Care Pipeline", company: "Clinic", account: "Clinic", accounts: "Clinics",
      customers: "Pet Owners", salesHub: "Care Hub", pipelineValue: "Care Revenue",
      value: "Est. Revenue", closeDate: "Appointment Date", stage: "Status",
    }),
    pipelineStages: ["Inquiry", "Appointment", "Diagnosis", "Treatment Plan", "In Treatment", "Completed", "Follow-Up"],
    customFields: [
      { id: "pet_name", label: "Pet Name", type: "text", entity: "contact" },
      { id: "species", label: "Species", type: "select", entity: "contact", options: ["Dog", "Cat", "Bird", "Reptile", "Exotic", "Other"] },
      { id: "treatment", label: "Treatment", type: "text", entity: "deal" },
    ],
    contactStatuses: ["New", "Active Client", "Recall Due", "Inactive"],
    noteTypes: ["Consultation", "Call", "Email", "Appointment", "Follow-Up"],
  },
  {
    id: "cybersecurity", name: "Cybersecurity", icon: "🔐", industry: "cybersecurity",
    terminology: withDefaults({
      contact: "Security Contact", contacts: "Security Contacts", deal: "Engagement", deals: "Engagements",
      pipeline: "Security Pipeline", account: "Organization", accounts: "Organizations",
      customers: "Clients", salesHub: "Security Hub", pipelineValue: "Bookings",
      value: "Contract Value", closeDate: "Kickoff Date", stage: "Phase",
    }),
    pipelineStages: ["Lead", "Assessment", "Scoping", "Proposal", "SOW Signed", "Active", "Renewal", "Lost"],
    customFields: [
      { id: "service_line", label: "Service Line", type: "select", entity: "deal", options: ["MDR", "Pen Test", "vCISO", "Compliance", "IR Retainer", "Training", "GRC"] },
      { id: "framework", label: "Framework", type: "select", entity: "deal", options: ["NIST", "CMMC", "SOC 2", "ISO 27001", "HIPAA", "PCI"] },
      { id: "mrr", label: "MRR", type: "number", entity: "deal" },
    ],
    contactStatuses: ["Prospect", "Assessment", "Active Client", "Renewal Due", "Inactive"],
    noteTypes: ["Assessment", "Call", "Email", "Incident", "QBR", "Proposal"],
  },
  {
    id: "msp", name: "MSP / IT Services", icon: "🛠️", industry: "msp",
    terminology: withDefaults({
      contact: "IT Contact", contacts: "IT Contacts", deal: "Managed Service", deals: "Managed Services",
      pipeline: "MSA Pipeline", account: "Client Site", accounts: "Client Sites",
      customers: "Clients", salesHub: "MSP Hub", pipelineValue: "MRR Pipeline",
      value: "MRR", closeDate: "Onboarding Date", stage: "Stage",
    }),
    pipelineStages: ["Lead", "Discovery", "Audit", "Proposal", "Onboarding", "Active", "Renewal", "Churned"],
    customFields: [
      { id: "endpoints", label: "Managed Endpoints", type: "number", entity: "deal" },
      { id: "stack", label: "Stack", type: "select", entity: "deal", options: ["M365", "Google Workspace", "Azure", "AWS", "Hybrid", "On-Prem"] },
      { id: "sla", label: "SLA Tier", type: "select", entity: "deal", options: ["Bronze", "Silver", "Gold", "Platinum"] },
      { id: "mrr", label: "MRR", type: "number", entity: "deal" },
    ],
    contactStatuses: ["Prospect", "Onboarding", "Active", "At-Risk", "Churned"],
    noteTypes: ["Discovery", "Audit", "Call", "Email", "Onboarding", "QBR"],
  },
  {
    id: "telecom", name: "Telecommunications", icon: "📡", industry: "telecom",
    terminology: withDefaults({
      contact: "Buyer", contacts: "Buyers", deal: "Circuit / Service", deals: "Circuits & Services",
      pipeline: "Sales Pipeline", account: "Location", accounts: "Locations",
      customers: "Subscribers", salesHub: "Carrier Hub", pipelineValue: "MRC Pipeline",
      value: "MRC", closeDate: "Install Date", stage: "Status",
    }),
    pipelineStages: ["Lead", "Qualified", "Design", "Quote", "Contract", "Provisioned", "Active", "Renewed", "Lost"],
    customFields: [
      { id: "service_type", label: "Service Type", type: "select", entity: "deal", options: ["Fiber", "MPLS", "SD-WAN", "UCaaS", "DIA", "Wireless"] },
      { id: "mrc", label: "MRC", type: "number", entity: "deal" },
      { id: "term_months", label: "Term (months)", type: "number", entity: "deal" },
    ],
    contactStatuses: ["Prospect", "Quoted", "Active", "Renewal Due", "Inactive"],
    noteTypes: ["Call", "Email", "Site Survey", "Quote", "Install"],
  },
  {
    id: "energy-utilities", name: "Energy & Utilities", icon: "⚡", industry: "energy-utilities",
    terminology: withDefaults({
      contact: "Account Manager", contacts: "Account Managers", deal: "Contract", deals: "Contracts",
      pipeline: "Contract Pipeline", account: "Facility", accounts: "Facilities",
      customers: "Accounts", salesHub: "Energy Hub", pipelineValue: "Contract Value",
      value: "Annual Value", closeDate: "Effective Date", stage: "Status",
    }),
    pipelineStages: ["Lead", "Site Assessment", "Proposal", "Regulatory Review", "Awarded", "Active", "Renewal", "Lost"],
    customFields: [
      { id: "commodity", label: "Commodity", type: "select", entity: "deal", options: ["Electric", "Natural Gas", "Solar", "Wind", "Water", "Waste"] },
      { id: "usage_kwh", label: "Est. Annual Usage", type: "number", entity: "deal" },
      { id: "regulatory", label: "Regulatory Review", type: "checkbox", entity: "deal" },
    ],
    contactStatuses: ["Prospect", "Active", "Renewal Due", "Inactive"],
    noteTypes: ["Site Visit", "Call", "Email", "Proposal", "Regulatory"],
  },
  {
    id: "ecommerce", name: "E-Commerce / D2C", icon: "🛒", industry: "ecommerce",
    terminology: withDefaults({
      contact: "Buyer", contacts: "Buyers", deal: "Account", deals: "Accounts",
      pipeline: "Wholesale Pipeline", account: "Brand", accounts: "Brands",
      customers: "Retailers", salesHub: "Commerce Hub", pipelineValue: "GMV Pipeline",
      value: "Order Value", closeDate: "Launch Date", stage: "Status",
    }),
    pipelineStages: ["Lead", "Sample Sent", "Wholesale Account", "Active Account", "Reorder", "Churned"],
    customFields: [
      { id: "channel", label: "Channel", type: "select", entity: "deal", options: ["D2C", "Wholesale", "Amazon", "Shopify", "Marketplace", "Retail"] },
      { id: "aov", label: "Avg Order Value", type: "number", entity: "deal" },
      { id: "sku_count", label: "SKU Count", type: "number", entity: "deal" },
    ],
    contactStatuses: ["Lead", "Sample", "Active", "VIP", "Churned"],
    noteTypes: ["Call", "Email", "Sample", "Launch", "Reorder"],
  },
  {
    id: "aerospace-defense", name: "Aerospace & Defense", icon: "🛩️", industry: "aerospace-defense",
    terminology: withDefaults({
      contact: "Program Contact", contacts: "Program Contacts", deal: "Program", deals: "Programs",
      pipeline: "Program Pipeline", account: "Prime / OEM", accounts: "Primes & OEMs",
      customers: "Programs", salesHub: "Programs Hub", pipelineValue: "Backlog",
      value: "Program Value", closeDate: "Award Date", stage: "Phase",
    }),
    pipelineStages: ["Opportunity ID", "B&P", "Proposal", "Award", "Delivery", "Sustainment", "Lost"],
    customFields: [
      { id: "platform", label: "Platform / Program", type: "text", entity: "deal" },
      { id: "itar", label: "ITAR Controlled", type: "checkbox", entity: "deal" },
      { id: "clearance", label: "Clearance Level", type: "select", entity: "deal", options: ["None", "Secret", "Top Secret", "TS/SCI"] },
      { id: "contract_vehicle", label: "Contract Vehicle", type: "text", entity: "deal" },
    ],
    contactStatuses: ["Prospect", "Active Program", "Past Performance", "Inactive"],
    noteTypes: ["Industry Day", "Call", "Email", "Proposal", "Program Review"],
  },
  {
    id: "pharma-life-sciences", name: "Pharma & Life Sciences", icon: "🧬", industry: "pharma-life-sciences",
    terminology: withDefaults({
      contact: "Stakeholder", contacts: "Stakeholders", deal: "Program", deals: "Programs",
      pipeline: "Development Pipeline", account: "Site", accounts: "Sites",
      customers: "Partners", salesHub: "Life Sciences Hub", pipelineValue: "Program Value",
      value: "Deal Value", closeDate: "Milestone Date", stage: "Phase",
    }),
    pipelineStages: ["Lead", "Scientific Review", "Pilot", "Clinical / Regulatory", "Commercial", "Active", "Lost"],
    customFields: [
      { id: "therapeutic_area", label: "Therapeutic Area", type: "text", entity: "deal" },
      { id: "phase", label: "Trial Phase", type: "select", entity: "deal", options: ["Preclinical", "Phase I", "Phase II", "Phase III", "NDA/BLA", "Commercial"] },
      { id: "gxp", label: "GxP Required", type: "checkbox", entity: "deal" },
    ],
    contactStatuses: ["Prospect", "Active", "Partner", "Inactive"],
    noteTypes: ["Scientific Review", "Call", "Email", "Regulatory", "Site Visit"],
  },
  {
    id: "property-management", name: "Property Management", icon: "🏢", industry: "property-management",
    terminology: withDefaults({
      contact: "Tenant", contacts: "Tenants", deal: "Lease", deals: "Leases",
      pipeline: "Leasing Pipeline", account: "Property", accounts: "Properties",
      customers: "Tenants", salesHub: "Leasing Hub", pipelineValue: "Lease Value",
      value: "Monthly Rent", closeDate: "Lease Start", stage: "Status",
    }),
    pipelineStages: ["Inquiry", "Tour", "Application", "Lease Signed", "Active", "Renewal", "Vacated"],
    customFields: [
      { id: "unit", label: "Unit / Suite", type: "text", entity: "deal" },
      { id: "sqft", label: "Square Feet", type: "number", entity: "deal" },
      { id: "lease_term", label: "Lease Term (months)", type: "number", entity: "deal" },
    ],
    contactStatuses: ["Prospect", "Applicant", "Active Tenant", "Past Tenant"],
    noteTypes: ["Tour", "Call", "Email", "Application", "Maintenance"],
  },
  {
    id: "franchise", name: "Franchise Development", icon: "🍔", industry: "franchise",
    terminology: withDefaults({
      contact: "Franchisee", contacts: "Franchisees", deal: "Franchise Sale", deals: "Franchise Sales",
      pipeline: "Development Pipeline", account: "Territory", accounts: "Territories",
      customers: "Franchisees", salesHub: "Development Hub", pipelineValue: "Franchise Fees",
      value: "Franchise Fee", closeDate: "Opening Date", stage: "Stage",
    }),
    pipelineStages: ["Inquiry", "Discovery Day", "FDD Review", "Signed", "Opening", "Active", "Lost"],
    customFields: [
      { id: "territory", label: "Territory", type: "text", entity: "deal" },
      { id: "units", label: "Planned Units", type: "number", entity: "deal" },
      { id: "fdd_sent", label: "FDD Sent", type: "checkbox", entity: "deal" },
    ],
    contactStatuses: ["Lead", "Candidate", "Franchisee", "Multi-Unit", "Inactive"],
    noteTypes: ["Discovery Day", "Call", "Email", "FDD", "Opening"],
  },
  {
    id: "staffing", name: "Staffing & Temp Labor", icon: "👥", industry: "staffing",
    terminology: withDefaults({
      contact: "Candidate", contacts: "Candidates", deal: "Placement", deals: "Placements",
      pipeline: "Placement Pipeline", account: "Client Site", accounts: "Client Sites",
      customers: "Clients", salesHub: "Staffing Hub", pipelineValue: "Placement Revenue",
      value: "Bill Rate", closeDate: "Start Date", stage: "Status",
    }),
    pipelineStages: ["Requisition", "Sourced", "Screened", "Submitted", "Interview", "Offer", "Placed", "Rejected"],
    customFields: [
      { id: "bill_rate", label: "Bill Rate", type: "number", entity: "deal" },
      { id: "pay_rate", label: "Pay Rate", type: "number", entity: "deal" },
      { id: "assignment_type", label: "Assignment Type", type: "select", entity: "deal", options: ["Temp", "Temp-to-Hire", "Direct Hire", "Contract"] },
    ],
    contactStatuses: ["Candidate", "Active Assignment", "Available", "Do Not Place"],
    noteTypes: ["Screen", "Interview", "Call", "Email", "Submission"],
  },
  {
    id: "custom", name: "Custom", icon: "⚙️", industry: "custom",
    terminology: withDefaults({}),
    pipelineStages: ["Stage 1", "Stage 2", "Stage 3", "Won", "Lost"],
    customFields: [],
    contactStatuses: ["Lead", "Active", "Customer", "Inactive"],
    noteTypes: ["Call", "Email", "Meeting", "Other"],
  },
];

export const DEFAULT_INDUSTRY_CONFIG = INDUSTRY_TEMPLATES[0]; // Sales/SaaS

export function getTermLabel(config: IndustryConfig | null, key: keyof IndustryTerminology): string {
  return config?.terminology?.[key] || DEFAULT_TERMINOLOGY[key];
}
