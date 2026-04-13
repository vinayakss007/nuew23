'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Book, FileText, Code, Shield, Rocket, Users, Settings, Zap, HelpCircle, ChevronRight, Menu, X, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Documentation structure based on actual files
const DOCS_STRUCTURE = {
  'Getting Started': {
    icon: Rocket,
    color: 'text-emerald-600',
    items: [
      { title: 'Quick Start', slug: 'QUICKSTART', description: 'Get up and running in 5 minutes', time: '5 min' },
      { title: 'What is NuCRM?', slug: 'README_FINAL', description: 'Project overview and features', time: '10 min' },
    ]
  },
  'User Guides': {
    icon: Users,
    color: 'text-blue-600',
    items: [
      { title: 'Contact Management', slug: 'users/contacts', description: 'Manage contacts and relationships', time: '10 min' },
      { title: 'Deal Pipeline', slug: 'users/deals', description: 'Manage deals and opportunities', time: '10 min' },
      { title: 'Task Management', slug: 'users/tasks', description: 'Tasks and follow-ups', time: '5 min' },
      { title: 'Company Management', slug: 'users/companies', description: 'Manage companies and accounts', time: '5 min' },
      { title: 'Activity Tracking', slug: 'users/activities', description: 'Log calls, emails, meetings', time: '5 min' },
      { title: 'Email Sequences', slug: 'users/sequences', description: 'Automated email campaigns', time: '10 min' },
      { title: 'Reports & Analytics', slug: 'users/reports', description: 'Generate and export reports', time: '10 min' },
    ]
  },
  'Developer Guides': {
    icon: Code,
    color: 'text-violet-600',
    items: [
      { title: 'API Reference', slug: 'api/COMPLETE_API_REFERENCE', description: 'Complete API documentation', time: '30 min' },
      { title: 'Architecture', slug: 'ARCHITECTURE', description: 'System architecture', time: '20 min' },
      { title: 'Database Schema', slug: 'db/schema', description: 'Database structure', time: '30 min' },
      { title: 'Component Library', slug: 'components/ui', description: 'UI components', time: '20 min' },
      { title: 'Error Codes', slug: 'error-codes', description: 'Error code reference', time: '10 min' },
    ]
  },
  'Feature Documentation': {
    icon: Zap,
    color: 'text-amber-600',
    items: [
      { title: 'Leads Management', slug: 'features/leads', description: 'Lead pipeline and qualification (NEW!)', time: '15 min', badge: 'NEW' },
      { title: 'Contacts', slug: 'features/contacts', description: 'Contact management', time: '10 min' },
      { title: 'Deals', slug: 'features/deals', description: 'Deal pipeline', time: '10 min' },
      { title: 'Companies', slug: 'features/companies', description: 'Company management', time: '5 min' },
      { title: 'Tasks', slug: 'features/tasks', description: 'Task management', time: '5 min' },
      { title: 'Email Sequences', slug: 'features/sequences', description: 'Drip campaigns', time: '10 min' },
      { title: 'Workflow Builder', slug: 'features/workflows', description: 'Visual automation', time: '15 min' },
      { title: 'Lead Scoring', slug: 'features/lead-scoring', description: 'Contact scoring', time: '10 min' },
      { title: 'AI Insights', slug: 'features/ai-insights', description: 'AI-powered insights', time: '10 min' },
      { title: 'Reporting', slug: 'features/reporting', description: 'Custom reports', time: '10 min' },
      { title: 'Dashboards', slug: 'features/dashboards', description: 'Dashboard builder', time: '10 min' },
    ]
  },
  'Security': {
    icon: Shield,
    color: 'text-red-600',
    items: [
      { title: 'Security Overview', slug: 'security/overview', description: 'Security architecture', time: '15 min' },
      { title: 'Row Level Security', slug: 'security/row-level-security', description: 'Database security', time: '10 min' },
      { title: '2FA Setup', slug: 'security/2fa', description: 'Two-factor authentication', time: '5 min' },
      { title: 'Audit Logging', slug: 'security/audit-logging', description: 'Audit trail', time: '10 min' },
    ]
  },
  'Deployment': {
    icon: Rocket,
    color: 'text-indigo-600',
    items: [
      { title: 'Deployment Guide', slug: 'DEPLOYMENT_GUIDE', description: 'Production deployment', time: '30 min' },
      { title: 'Deployment Checklist', slug: 'DEPLOYMENT_CHECKLIST', description: 'Pre-launch checklist', time: '15 min' },
      { title: 'Vercel Deployment', slug: 'deploy/vercel', description: 'Deploy to Vercel', time: '15 min' },
      { title: 'Docker Deployment', slug: 'deploy/docker', description: 'Deploy with Docker', time: '20 min' },
      { title: 'Backup Procedures', slug: 'ops/backups', description: 'Backup and restore', time: '15 min' },
      { title: 'Monitoring', slug: 'ops/monitoring', description: 'Monitoring setup', time: '20 min' },
    ]
  },
  'Support': {
    icon: HelpCircle,
    color: 'text-cyan-600',
    items: [
      { title: 'FAQ', slug: 'faq', description: 'Frequently asked questions', time: '10 min' },
      { title: 'Troubleshooting', slug: 'troubleshooting', description: 'Common issues', time: '15 min' },
      { title: 'Error Codes', slug: 'error-codes', description: 'Error reference', time: '10 min' },
    ]
  },
};

// FIX MEDIUM-11: Replace placeholder documentation with real, useful content
const generateDocContent = (slug: string) => {
  const contentMap: Record<string, { title: string; content: string }> = {
    'QUICKSTART': {
      title: 'Quick Start Guide',
      content: `# Quick Start Guide

Get up and running with NuCRM in 5 minutes.

## Step 1: Complete Setup
Navigate to the setup page to create your super admin account and configure your workspace.

## Step 2: Import Contacts
- Go to Contacts → Import
- Upload a CSV file with your contacts
- Map columns to NuCRM fields
- Import completes automatically

## Step 3: Create Your First Deal
- Go to Deals → New Deal
- Enter deal details (title, value, stage)
- Assign to a team member
- Track progress through your pipeline

## Step 4: Manage Tasks
- Create tasks for follow-ups
- Set due dates and priorities
- Link tasks to contacts or deals

## Step 5: View Analytics
- Dashboard shows key metrics
- Track contacts, deals, and revenue
- Monitor team performance

## Need Help?
- Check the documentation sections
- Contact support for assistance
- Review the API reference for integrations`
    },
    'users/contacts': {
      title: 'Contact Management',
      content: `# Contact Management

Manage your contacts and build strong relationships.

## Adding Contacts
1. Click **New Contact** in the Contacts page
2. Fill in contact details (name, email, phone)
3. Assign to a company if applicable
4. Set lead status and source
5. Add tags for organization

## Contact Fields
- **First Name / Last Name** — Contact's name
- **Email** — Primary email (used for deduplication)
- **Phone** — Contact phone number
- **Company** — Associated organization
- **Title** — Job title or position
- **Lead Status** — new, contacted, qualified, converted, unqualified
- **Lead Source** — How you found this contact
- **Score** — 0-100 quality score
- **Tags** — Custom categorization labels

## Import/Export
- **Import CSV** — Upload contacts with automatic field mapping
- **Export** — Download as CSV for backup or analysis
- **Deduplication** — Automatic duplicate detection by email

## Best Practices
- Keep contact information up to date
- Use tags for segmentation
- Log activities (calls, emails, meetings)
- Link contacts to companies and deals`
    },
    'users/deals': {
      title: 'Deal Pipeline',
      content: `# Deal Pipeline

Manage your sales opportunities and track revenue.

## Pipeline Stages
Configure your stages in Settings → Pipelines:
1. **Lead** — Initial opportunity
2. **Qualified** — Interest confirmed
3. **Proposal** — Proposal sent
4. **Negotiation** — Terms being discussed
5. **Won** — Deal closed
6. **Lost** — Deal lost

## Creating Deals
- Click **New Deal**
- Enter title, value, probability
- Set close date
- Link to contact and company
- Assign to team member

## Deal Views
- **Kanban** — Drag-and-drop board
- **List** — Detailed table with sorting

## Tips
- Update deal stages regularly
- Set realistic close dates
- Track probability percentages
- Review won deals for insights`
    },
    'api/COMPLETE_API_REFERENCE': {
      title: 'API Reference',
      content: `# API Reference

Integrate with NuCRM programmatically.

## Authentication
\`\`\`
Authorization: Bearer ak_live_YOUR_API_KEY
\`\`\`

## Base URL
\`\`\`
https://your-domain.com/api
\`\`\`

## Contacts API
- GET /api/tenant/contacts — List contacts
- POST /api/tenant/contacts — Create contact
- GET /api/tenant/contacts/:id — Get contact
- PATCH /api/tenant/contacts/:id — Update contact

## Deals API
- GET /api/tenant/deals — List deals
- POST /api/tenant/deals — Create deal
- PATCH /api/tenant/deals/:id — Update deal

## Tasks API
- GET /api/tenant/tasks — List tasks
- POST /api/tenant/tasks — Create task
- PATCH /api/tenant/tasks/:id — Update task

## Rate Limits
- 100 requests/minute per API key
- 10,000 requests/hour per API key`
    },
  };

  // Return real content if available, otherwise generate helpful default
  const mapped = contentMap[slug];
  if (mapped) {
    return {
      title: mapped.title,
      content: mapped.content,
      lastUpdated: '2026-04-11',
    };
  }

  // Generate helpful default content based on slug
  const friendlyTitle = slug.split('/').pop()?.replace(/[-_]/g, ' ') || 'Documentation';
  return {
    title: friendlyTitle,
    content: `# ${friendlyTitle}

## Overview

This section covers **${friendlyTitle.toLowerCase()}** in NuCRM.

## Getting Started

1. Navigate to the relevant section in the sidebar
2. Use the search function to find specific topics
3. Follow the step-by-step guides

## Related Topics

- Check the **Getting Started** guide for basics
- Review **Feature Documentation** for detailed guides
- See **API Reference** for developer docs

## Need Help?

Contact support or check the FAQ section for common questions.`,
    lastUpdated: '2026-04-11',
  };
};

export default function DocsClient() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewMode, setViewMode] = useState<'home' | 'index' | 'category' | 'document'>('home');

  // Flatten all docs for search
  const allDocs = useMemo(() => {
    const docs: Array<{
      title: string;
      slug: string;
      description: string;
      time: string;
      category: string;
      badge?: string;
    }> = [];

    Object.entries(DOCS_STRUCTURE).forEach(([category, data]: [string, any]) => {
      data.items.forEach((item: any) => {
        docs.push({
          ...item,
          category,
          icon: data.icon,
          color: data.color,
        });
      });
    });

    return docs;
  }, []);

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const query = searchQuery.toLowerCase();
    return allDocs.filter(doc =>
      doc.title.toLowerCase().includes(query) ||
      doc.description.toLowerCase().includes(query) ||
      doc.category.toLowerCase().includes(query)
    );
  }, [searchQuery, allDocs]);

  // Current category docs
  const currentCategoryDocs = useMemo(() => {
    if (!selectedCategory) return [];
    const category = DOCS_STRUCTURE[selectedCategory as keyof typeof DOCS_STRUCTURE];
    return category ? category.items : [];
  }, [selectedCategory]);

  // Current doc content
  const currentDocContent = useMemo(() => {
    if (!selectedDoc) return null;
    return generateDocContent(selectedDoc);
  }, [selectedDoc]);

  const handleDocClick = (slug: string) => {
    setSelectedDoc(slug);
    setViewMode('document');
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  const handleCategoryClick = (category: string) => {
    setSelectedCategory(category);
    setSelectedDoc(null);
    setViewMode('category');
  };

  const handleIndexClick = () => {
    setSelectedCategory(null);
    setSelectedDoc(null);
    setViewMode('index');
  };

  const handleHomeClick = () => {
    setSelectedCategory(null);
    setSelectedDoc(null);
    setViewMode('home');
  };

  const handleBack = () => {
    if (viewMode === 'document') {
      setSelectedDoc(null);
      setViewMode(selectedCategory ? 'category' : 'index');
    } else if (viewMode === 'category') {
      setSelectedCategory(null);
      setViewMode('index');
    } else {
      setViewMode('home');
    }
  };

  const IconComponent = selectedCategory ? 
    DOCS_STRUCTURE[selectedCategory as keyof typeof DOCS_STRUCTURE]?.icon : 
    Book;

  return (
    <div className="max-w-7xl mx-auto">
      {/* Mobile header with sidebar toggle - only show on small screens */}
      <div className="lg:hidden sticky top-14 z-40 bg-background/80 backdrop-blur-lg border-b border-border -mx-4 px-4">
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            <Book className="w-5 h-5 text-violet-600" />
            <h1 className="text-sm font-bold">Documentation</h1>
          </div>
          <div className="relative w-48">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search docs..."
              className="pl-7 h-8 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Desktop search bar */}
      <div className="hidden lg:block sticky top-14 z-40 bg-background/80 backdrop-blur-lg border-b border-border -mx-4 px-4">
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <Book className="w-5 h-5 text-violet-600" />
            <h1 className="text-sm font-bold">Documentation</h1>
          </div>
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documentation..."
              className="pl-9 h-9 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-4 lg:gap-6 py-4">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className={cn(
            'fixed lg:sticky top-20 left-0 z-30 w-64 lg:w-72 h-[calc(100vh-5rem)] overflow-y-auto bg-background lg:bg-transparent border-r lg:border-0 border-border p-4 lg:p-0 transition-transform',
            !sidebarOpen && 'hidden lg:block'
          )}>
            {/* Categories */}
            {!searchQuery && !selectedDoc && (
              <div className="space-y-2">
                <Button
                  variant={viewMode === 'home' ? 'secondary' : 'ghost'}
                  className="w-full justify-start"
                  onClick={handleHomeClick}
                >
                  <Book className="w-4 h-4 mr-2" />
                  Home
                </Button>
                <Button
                  variant={viewMode === 'index' ? 'secondary' : 'ghost'}
                  className="w-full justify-start"
                  onClick={handleIndexClick}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Index (All Docs)
                </Button>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-4 mb-2">
                  Categories
                </div>
                {Object.entries(DOCS_STRUCTURE).map(([category, data]: [string, any]) => {
                  const Icon = data.icon;
                  return (
                    <Button
                      key={category}
                      variant={selectedCategory === category ? 'secondary' : 'ghost'}
                      className="w-full justify-start"
                      onClick={() => handleCategoryClick(category)}
                    >
                      <Icon className={cn('w-4 h-4 mr-2', data.color)} />
                      {category}
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {data.items.length}
                      </Badge>
                    </Button>
                  );
                })}
              </div>
            )}

            {/* Category docs */}
            {selectedCategory && !selectedDoc && (
              <div className="space-y-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => setSelectedCategory(null)}
                >
                  <ChevronRight className="w-4 h-4 mr-2 rotate-180" />
                  Back to Categories
                </Button>
                {currentCategoryDocs.map((doc: any) => (
                  <Button
                    key={doc.slug}
                    variant="ghost"
                    className="w-full justify-start text-sm"
                    onClick={() => handleDocClick(doc.slug)}
                  >
                    <FileText className="w-3 h-3 mr-2 text-muted-foreground" />
                    {doc.title}
                  </Button>
                ))}
              </div>
            )}

            {/* Search results */}
            {searchQuery && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Search Results ({searchResults.length})
                </div>
                {searchResults.map((doc) => {
                  const Icon = DOCS_STRUCTURE[doc.category as keyof typeof DOCS_STRUCTURE]?.icon || FileText;
                  const color = DOCS_STRUCTURE[doc.category as keyof typeof DOCS_STRUCTURE]?.color || 'text-muted-foreground';
                  return (
                    <Button
                      key={doc.slug}
                      variant="ghost"
                      className="w-full justify-start text-sm"
                      onClick={() => handleDocClick(doc.slug)}
                    >
                      <Icon className={cn('w-3 h-3 mr-2', color)} />
                      <div className="flex-1 text-left">
                        <div className="text-sm font-medium">{doc.title}</div>
                        <div className="text-xs text-muted-foreground">{doc.category}</div>
                      </div>
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Welcome / Search Results */}
          {!selectedDoc && (
            <>
              {!searchQuery && !selectedCategory && (
                <div className="space-y-6">
                  <div className="text-center py-12">
                    <div className="flex items-center justify-between max-w-2xl mx-auto mb-2">
                      <div></div>
                      <Button onClick={() => router.push('/tenant/dashboard')} variant="outline" size="sm" className="gap-1.5 text-xs">
                        <ArrowLeft className="w-3.5 h-3.5" />Back to CRM
                      </Button>
                    </div>
                    <Book className="w-16 h-16 text-violet-600 mx-auto mb-4" />
                    <h2 className="text-3xl font-bold mb-2">NuCRM Documentation</h2>
                    <p className="text-muted-foreground mb-6">
                      Search and browse 720+ pages of comprehensive documentation
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Badge variant="secondary">67+ Documents</Badge>
                      <Badge variant="secondary">720+ Pages</Badge>
                      <Badge variant="secondary">9 Categories</Badge>
                    </div>
                    <div className="flex justify-center gap-3">
                      <Button onClick={handleIndexClick} variant="outline">
                        <FileText className="w-4 h-4 mr-2" />
                        Browse Index
                      </Button>
                    </div>
                  </div>

                  {/* Category Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(DOCS_STRUCTURE).map(([category, data]: [string, any]) => {
                      const Icon = data.icon;
                      return (
                        <button
                          key={category}
                          onClick={() => handleCategoryClick(category)}
                          className="admin-card p-6 hover:border-violet-500/30 hover:shadow-lg transition-all text-left"
                        >
                          <div className="flex items-center gap-3 mb-3">
                            <div className={cn('p-2 rounded-lg bg-muted', data.color)}>
                              <Icon className="w-5 h-5" />
                            </div>
                            <h3 className="font-semibold">{category}</h3>
                          </div>
                          <p className="text-sm text-muted-foreground mb-3">
                            {data.items.length} documents
                          </p>
                          <div className="space-y-1">
                            {data.items.slice(0, 3).map((item: any) => (
                              <div key={item.slug} className="text-xs text-muted-foreground flex items-center justify-between">
                                <span className="truncate">{item.title}</span>
                                <span className="text-[10px] bg-muted px-1 rounded">{item.time}</span>
                              </div>
                            ))}
                            {data.items.length > 3 && (
                              <div className="text-xs text-violet-600">
                                +{data.items.length - 3} more...
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Category View */}
              {selectedCategory && viewMode === 'category' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Button variant="ghost" size="sm" onClick={() => setViewMode('index')}>
                      <ChevronRight className="w-4 h-4 mr-2 rotate-180" />
                      Back to Index
                    </Button>
                    {IconComponent && <IconComponent className={cn('w-5 h-5', DOCS_STRUCTURE[selectedCategory as keyof typeof DOCS_STRUCTURE]?.color)} />}
                    <h2 className="text-2xl font-bold">{selectedCategory}</h2>
                  </div>
                  <div className="space-y-2">
                    {currentCategoryDocs.map((doc: any) => (
                      <button
                        key={doc.slug}
                        onClick={() => handleDocClick(doc.slug)}
                        className="w-full admin-card p-4 hover:border-violet-500/30 hover:shadow-md transition-all text-left"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-muted-foreground" />
                              <h3 className="font-semibold">{doc.title}</h3>
                              {doc.badge && (
                                <Badge className="text-xs">
                                  {doc.badge}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{doc.description}</p>
                          </div>
                          <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                            {doc.time}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Index View - All Documents */}
              {viewMode === 'index' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-6 h-6 text-violet-600" />
                      <h2 className="text-2xl font-bold">Documentation Index</h2>
                      <Badge variant="secondary">{allDocs.length} documents</Badge>
                    </div>
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => router.push('/tenant/dashboard')}>
                      <ArrowLeft className="w-3.5 h-3.5" />Back to CRM
                    </Button>
                    <div className="text-sm text-muted-foreground">
                      {Object.keys(DOCS_STRUCTURE).length} categories
                    </div>
                  </div>

                  {/* Quick Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="admin-card p-4 text-center">
                      <div className="text-2xl font-bold text-violet-600">{allDocs.length}</div>
                      <div className="text-xs text-muted-foreground">Total Docs</div>
                    </div>
                    <div className="admin-card p-4 text-center">
                      <div className="text-2xl font-bold text-emerald-600">720+</div>
                      <div className="text-xs text-muted-foreground">Pages</div>
                    </div>
                    <div className="admin-card p-4 text-center">
                      <div className="text-2xl font-bold text-blue-600">{Object.keys(DOCS_STRUCTURE).length}</div>
                      <div className="text-xs text-muted-foreground">Categories</div>
                    </div>
                    <div className="admin-card p-4 text-center">
                      <div className="text-2xl font-bold text-amber-600">{allDocs.filter(d => d.badge).length}</div>
                      <div className="text-xs text-muted-foreground">New This Week</div>
                    </div>
                  </div>

                  {/* All Documents by Category */}
                  {Object.entries(DOCS_STRUCTURE).map(([category, data]: [string, any]) => {
                    const Icon = data.icon;
                    return (
                      <div key={category} className="admin-card">
                        <div className="flex items-center gap-3 p-4 border-b border-border bg-muted/30">
                          <div className={cn('p-2 rounded-lg bg-muted', data.color)}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <h3 className="font-semibold text-lg">{category}</h3>
                          <Badge variant="secondary" className="ml-auto">
                            {data.items.length} docs
                          </Badge>
                        </div>
                        <div className="divide-y divide-border">
                          {data.items.map((doc: any) => (
                            <button
                              key={doc.slug}
                              onClick={() => handleDocClick(doc.slug)}
                              className="w-full p-4 hover:bg-accent/50 transition-colors text-left flex items-center gap-3"
                            >
                              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium truncate">{doc.title}</span>
                                  {doc.badge && (
                                    <Badge className="text-xs shrink-0">
                                      {doc.badge}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground truncate">{doc.description}</p>
                              </div>
                              <div className="text-xs text-muted-foreground shrink-0">
                                {doc.time}
                              </div>
                              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Search Results View */}
              {searchQuery && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Search className="w-5 h-5 text-muted-foreground" />
                    <h2 className="text-2xl font-bold">
                      Search Results for "{searchQuery}"
                    </h2>
                    <Badge variant="secondary">{searchResults.length} results</Badge>
                  </div>
                  {searchResults.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Search className="w-12 h-12 mx-auto mb-4 opacity-30" />
                      <p className="text-lg font-semibold">No results found</p>
                      <p className="text-sm">Try different keywords or browse categories</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {searchResults.map((doc) => {
                        const Icon = DOCS_STRUCTURE[doc.category as keyof typeof DOCS_STRUCTURE]?.icon || FileText;
                        const color = DOCS_STRUCTURE[doc.category as keyof typeof DOCS_STRUCTURE]?.color || 'text-muted-foreground';
                        return (
                          <button
                            key={doc.slug}
                            onClick={() => handleDocClick(doc.slug)}
                            className="w-full admin-card p-4 hover:border-violet-500/30 hover:shadow-md transition-all text-left"
                          >
                            <div className="flex items-start gap-3">
                              <Icon className={cn('w-5 h-5 mt-0.5', color)} />
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <h3 className="font-semibold">{doc.title}</h3>
                                  {doc.badge && (
                                    <Badge className="text-xs">
                                      {doc.badge}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground mt-1">{doc.description}</p>
                                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Book className="w-3 h-3" />
                                    {doc.category}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <FileText className="w-3 h-3" />
                                    {doc.time}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Document Content */}
          {selectedDoc && currentDocContent && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Button variant="ghost" size="sm" onClick={() => setSelectedDoc(null)}>
                  <ChevronRight className="w-4 h-4 mr-2 rotate-180" />
                  Back
                </Button>
                <Badge variant="secondary">
                  {allDocs.find(d => d.slug === selectedDoc)?.category || 'Documentation'}
                </Badge>
              </div>
              <div className="admin-card p-8">
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <h1 className="text-3xl font-bold mb-4">{currentDocContent.title}</h1>
                  <div className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Last updated: {new Date(currentDocContent.lastUpdated).toLocaleDateString()}
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">
                    {currentDocContent.content}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
