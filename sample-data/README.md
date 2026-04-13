# NuCRM — Sample Data Upload Files
#
# How to use:
# 1. Create an account at /setup
# 2. Go to your workspace
# 3. Use the Import feature to upload these CSV files
#
# Each file maps to one table. Download these as templates.

---

## contacts.csv

first_name,last_name,email,phone,title,company_name,lead_status,lead_source,lifecycle_stage,score,city,country,website,linkedin_url,tags
John,Doe,john.doe@acme.com,+1-555-0101,CEO,Acme Corp,qualified,website,opportunity,85,New York,US,https://acme.com,https://linkedin.com/in/johndoe,"hot,enterprise"
Jane,Smith,jane@techstart.io,+1-555-0102,CTO,TechStart,new,referral,lead,60,San Francisco,US,https://techstart.io,,startup
Bob,Johnson,bob.j@globaltech.com,+1-555-0103,VP Sales,GlobalTech,contacted,cold_outreach,sales_qualified_lead,72,Chicago,US,https://globaltech.com,https://linkedin.com/in/bobjohnson,"mid-market,sales"
Alice,Williams,alice@innovate.co,+1-555-0104,Marketing Director,Innovate Inc,nurturing,social_media,marketing_qualified_lead,45,Austin,US,https://innovate.co,,
Charlie,Brown,charlie.b@startup.io,+1-555-0105,Founder,Startup Co,converted,event,opportunity,90,London,GB,https://startup.io,https://linkedin.com/in/charliebrown,"hot,seed"

---

## leads.csv

first_name,last_name,email,phone,title,company_name,company_size,company_industry,lead_status,lead_source,lifecycle_stage,budget,authority_level,country,state,city,website,utm_source,utm_campaign
David,Miller,d.miller@bigco.com,+1-555-0201,Director,BigCo Inc,501-1000,Technology,new,website,lead,50000,decision_maker,US,California,San Jose,https://bigco.com,google,q1_campaign
Eva,Martinez,eva.m@midsize.com,+1-555-0202,Manager,MidSize LLC,51-200,Healthcare,contacted,referral,sales_qualified_lead,25000,influencer,US,Texas,Dallas,,linkedin,outreach
Frank,Lee,frank@tiny.co,+1-555-0203,Owner,Tiny Co,1-10,Education,qualified,cold_outreach,lead,5000,decision_maker,US,New York,Brooklyn,https://tiny.co,,email_sequence
Grace,Kim,grace.kim@enterprise.com,+1-555-0204,VP Engineering,Enterprise Global,1000+,Manufacturing,nurturing,event,marketing_qualified_lead,100000,decision_maker,US,Washington,Seattle,https://enterprise.com,conference,sponsor_2026
Henry,Wilson,henry@agency.io,+1-555-0205,Account Director,Agency Pro,11-50,Marketing,new,website,lead,15000,unknown,CA,California,Los Angeles,https://agency.io,facebook,brand_awareness

---

## companies.csv

name,website,industry,size,phone,city,state,country,status
Acme Corp,https://acme.com,Technology,51-200,+1-555-1001,New York,NY,US,active
TechStart,https://techstart.io,Software,1-10,+1-555-1002,San Francisco,CA,US,active
GlobalTech,https://globaltech.com,Consulting,201-500,+1-555-1003,Chicago,IL,US,active
Innovate Inc,https://innovate.co,Marketing,11-50,+1-555-1004,Austin,TX,US,active
Startup Co,https://startup.io,FinTech,1-10,+1-555-1005,London,,GB,trial

---

## deals.csv

title,value,stage,probability,close_date,contact_email,notes
Acme Corp Platform Deal,120000,proposal,50,2026-06-30,john.doe@acme.com,Enterprise platform renewal
TechStart Integration,45000,negotiation,75,2026-05-15,jane@techstart.io,API integration project
GlobalTech Consulting,85000,qualified,20,2026-09-01,bob.j@globaltech.com,Annual consulting retainer
Startup Co Migration,30000,won,100,2026-04-01,charlie.b@startup.io,Cloud migration completed
Agency Pro Campaign,22000,lead,10,2026-08-15,henry@agency.io,Digital marketing campaign

---

## tasks.csv

title,description,due_date,priority,status,contact_email,deal_title
Follow up with John,Schedule demo for new platform features,2026-04-15,high,pending,john.doe@acme.com,Acme Corp Platform Deal
Send proposal to Jane,Finalize pricing and send PDF,2026-04-12,high,pending,jane@techstart.io,TechStart Integration
Quarterly review with Bob,Review contract terms for renewal,2026-04-20,medium,pending,bob.j@globaltech.com,GlobalTech Consulting
Onboarding checklist for Charlie,Complete setup and training,2026-04-08,high,in_progress,charlie.b@startup.io,Startup Co Migration
Research Agency Pro needs,Gather requirements from discovery call,2026-04-18,low,pending,henry@agency.io,Agency Pro Campaign

---
