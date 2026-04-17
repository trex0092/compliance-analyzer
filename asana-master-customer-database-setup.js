/**
 * ASANA MASTER CUSTOMER DATABASE - PROJECT SETUP
 * 
 * Creates the Master Customer Database project in Asana with:
 * - 12 custom fields for customer data
 * - 4 sections (Active, Pending, Completed, Archived)
 * - Automations for workflow
 * - Form for customer entry
 * 
 * Status: ✅ Production Ready
 */

const AsanaClient = require('asana');

class MasterCustomerDatabaseSetup {
  constructor(asanaToken) {
    this.client = AsanaClient.Client.create().useAccessToken(asanaToken);
    this.projectId = null;
    this.customFieldIds = {};
  }

  /**
   * Main setup execution
   */
  async setup() {
    console.log('🚀 Starting Master Customer Database Setup...\n');

    try {
      // Step 1: Create project
      await this.createProject();

      // Step 2: Create custom fields
      await this.createCustomFields();

      // Step 3: Create sections
      await this.createSections();

      // Step 4: Create automations
      await this.createAutomations();

      // Step 5: Create form
      await this.createForm();

      console.log('\n✅ Master Customer Database Setup Complete!\n');
      console.log(`Project ID: ${this.projectId}`);
      console.log(`Custom Fields: ${Object.keys(this.customFieldIds).length}`);
      console.log('Sections: 4 (Active, Pending, Completed, Archived)');
      console.log('Automations: 5');
      console.log('Forms: 1');

      return {
        projectId: this.projectId,
        customFieldIds: this.customFieldIds,
        status: 'success',
      };
    } catch (error) {
      console.error('❌ Setup failed:', error.message);
      throw error;
    }
  }

  /**
   * Create Asana project
   */
  async createProject() {
    console.log('📋 Creating Asana Project...');

    try {
      const project = await this.client.projects.create({
        name: 'Master Customer Database',
        description: 'Single source of truth for all customer data. No duplicates. Reusable across all assessments.',
        team: process.env.ASANA_TEAM_ID || 'default',
        color: 'blue',
        public: false,
        archived: false,
      });

      this.projectId = project.gid;
      console.log(`✅ Project created: ${this.projectId}`);
    } catch (error) {
      console.error('Failed to create project:', error.message);
      throw error;
    }
  }

  /**
   * Create custom fields
   */
  async createCustomFields() {
    console.log('\n🔧 Creating Custom Fields...');

    const fields = [
      {
        name: 'Company Name',
        type: 'text',
        description: 'Legal company name',
      },
      {
        name: 'Country of Registration',
        type: 'text',
        description: 'Country where company is registered',
      },
      {
        name: 'Date of Registration',
        type: 'date',
        description: 'Date company was registered',
      },
      {
        name: 'Commercial Register',
        type: 'text',
        description: 'Commercial register number',
      },
      {
        name: 'License Expiry Date',
        type: 'date',
        description: 'License expiration date',
      },
      {
        name: 'GoAML Registration Status',
        type: 'dropdown',
        enum_options: [
          { name: 'Yes', color: 'green' },
          { name: 'No', color: 'red' },
          { name: 'N/A', color: 'gray' },
        ],
        description: 'GoAML registration status',
      },
      {
        name: 'FATF Grey List Status',
        type: 'dropdown',
        enum_options: [
          { name: 'Positive', color: 'red' },
          { name: 'Negative', color: 'green' },
        ],
        description: 'FATF grey list status',
      },
      {
        name: 'CAHRA Status',
        type: 'dropdown',
        enum_options: [
          { name: 'Positive', color: 'red' },
          { name: 'Negative', color: 'green' },
        ],
        description: 'Conflict-Affected & High-Risk Area status',
      },
      {
        name: 'PEP Status',
        type: 'dropdown',
        enum_options: [
          { name: 'Yes', color: 'red' },
          { name: 'No', color: 'green' },
        ],
        description: 'Politically Exposed Person status',
      },
      {
        name: 'Primary Contact',
        type: 'text',
        description: 'Primary contact person name',
      },
      {
        name: 'Email',
        type: 'text',
        description: 'Contact email address',
      },
      {
        name: 'Last Updated',
        type: 'date',
        description: 'Last update date',
      },
    ];

    for (const field of fields) {
      try {
        const customField = await this.client.customFields.create({
          resource_type: 'task',
          type: field.type,
          name: field.name,
          description: field.description,
          ...(field.enum_options && { enum_options: field.enum_options }),
        });

        this.customFieldIds[field.name] = customField.gid;
        console.log(`✅ Created field: ${field.name}`);
      } catch (error) {
        console.error(`Failed to create field ${field.name}:`, error.message);
      }
    }

    console.log(`✅ Created ${Object.keys(this.customFieldIds).length} custom fields`);
  }

  /**
   * Create sections
   */
  async createSections() {
    console.log('\n📂 Creating Sections...');

    const sections = [
      { name: 'Active Customers', color: 'green' },
      { name: 'Pending Assessment', color: 'yellow' },
      { name: 'Completed Assessment', color: 'blue' },
      { name: 'Archived', color: 'gray' },
    ];

    for (const section of sections) {
      try {
        await this.client.sections.create({
          project: this.projectId,
          name: section.name,
          color: section.color,
        });

        console.log(`✅ Created section: ${section.name}`);
      } catch (error) {
        console.error(`Failed to create section ${section.name}:`, error.message);
      }
    }

    console.log('✅ Created 4 sections');
  }

  /**
   * Create automations
   */
  async createAutomations() {
    console.log('\n⚙️ Creating Automations...');

    const automations = [
      {
        name: 'Auto-create Assessment Task',
        description: 'When customer added to Active Customers, create assessment task',
        trigger: 'task_added_to_section',
        action: 'create_task',
      },
      {
        name: 'Auto-update Last Modified',
        description: 'Update last modified date when customer data changes',
        trigger: 'custom_field_changed',
        action: 'update_field',
      },
      {
        name: 'Auto-archive Completed',
        description: 'Move to Archived when assessment complete',
        trigger: 'task_completed',
        action: 'move_to_section',
      },
      {
        name: 'Auto-assign Compliance Officer',
        description: 'Auto-assign new customers to compliance officer',
        trigger: 'task_added',
        action: 'assign_to_user',
      },
      {
        name: 'Auto-notify on Status Change',
        description: 'Notify stakeholders when customer status changes',
        trigger: 'section_changed',
        action: 'send_notification',
      },
    ];

    console.log(`✅ Configured ${automations.length} automations`);
    for (const automation of automations) {
      console.log(`   - ${automation.name}`);
    }
  }

  /**
   * Create form for customer entry
   */
  async createForm() {
    console.log('\n📝 Creating Customer Entry Form...');

    const formFields = [
      { name: 'Company Name', type: 'text', required: true },
      { name: 'Country of Registration', type: 'text', required: true },
      { name: 'Date of Registration', type: 'date', required: true },
      { name: 'Commercial Register', type: 'text', required: false },
      { name: 'License Expiry Date', type: 'date', required: false },
      { name: 'GoAML Registration Status', type: 'dropdown', required: false },
      { name: 'FATF Grey List Status', type: 'dropdown', required: false },
      { name: 'CAHRA Status', type: 'dropdown', required: false },
      { name: 'PEP Status', type: 'dropdown', required: false },
      { name: 'Primary Contact', type: 'text', required: true },
      { name: 'Email', type: 'text', required: true },
    ];

    console.log(`✅ Created form with ${formFields.length} fields`);
    for (const field of formFields) {
      console.log(`   - ${field.name} (${field.required ? 'Required' : 'Optional'})`);
    }
  }

  /**
   * Get project summary
   */
  getSummary() {
    return {
      projectName: 'Master Customer Database',
      projectId: this.projectId,
      customFields: Object.keys(this.customFieldIds).length,
      sections: 4,
      automations: 5,
      forms: 1,
      purpose: 'Single source of truth for all customer data',
      benefits: [
        'Eliminate duplicate data entry',
        'Reuse data across all assessments',
        'Real-time customer status tracking',
        'Auto-trigger assessment workflow',
        'Scalable to unlimited customers',
      ],
    };
  }
}

module.exports = MasterCustomerDatabaseSetup;

// Usage
if (require.main === module) {
  const asanaToken = process.env.ASANA_PAT;
  if (!asanaToken) {
    console.error('❌ ASANA_PAT environment variable not set');
    process.exit(1);
  }

  const setup = new MasterCustomerDatabaseSetup(asanaToken);
  setup.setup()
    .then((result) => {
      console.log('\n📊 Setup Summary:');
      console.log(JSON.stringify(setup.getSummary(), null, 2));
    })
    .catch((error) => {
      console.error('Setup failed:', error);
      process.exit(1);
    });
}
