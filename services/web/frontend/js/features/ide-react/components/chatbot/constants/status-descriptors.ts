import { StatusSummaryDescriptor } from '../types/chatbot-types'

export const STATUS_SUMMARY_DESCRIPTORS: Record<string, StatusSummaryDescriptor> = {
  read_file: {
    key: 'read-file',
    label: 'Read',
    singular: 'file',
    plural: 'files',
    countable: true,
  },
  read_skill: {
    key: 'read-skill',
    label: 'Read',
    singular: 'skill',
    plural: 'skills',
    countable: true,
  },
  get_outline: {
    key: 'get-outline',
    label: 'Read outline',
  },
  get_pdf_page: {
    key: 'get-pdf-page',
    label: 'Read',
    singular: 'PDF page',
    plural: 'PDF pages',
    countable: true,
  },
  create_file: {
    key: 'create-file',
    label: 'Created',
    singular: 'file',
    plural: 'files',
    countable: true,
  },
  edit_file: {
    key: 'edit-file',
    label: 'Edited',
    singular: 'file',
    plural: 'files',
    countable: true,
  },
  delete_file: {
    key: 'delete-file',
    label: 'Deleted',
    singular: 'file',
    plural: 'files',
    countable: true,
  },
  move_file: {
    key: 'move-file',
    label: 'Moved',
    singular: 'file',
    plural: 'files',
    countable: true,
  },
  list_files: {
    key: 'list-files',
    label: 'Listed files',
  },
  list_skills: {
    key: 'list-skills',
    label: 'Listed skills',
  },
  check_syntax: {
    key: 'check-syntax',
    label: 'Checked syntax',
  },
  compile_and_check: {
    key: 'compile-and-check',
    label: 'Compiled project',
  },
}
