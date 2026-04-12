/*
 Navicat Premium Dump SQL

 Source Server         : fwwb
 Source Server Type    : PostgreSQL
 Source Server Version : 160013 (160013)
 Source Host           : localhost:5432
 Source Catalog        : antifraud
 Source Schema         : public

 Target Server Type    : PostgreSQL
 Target Server Version : 160013 (160013)
 File Encoding         : 65001

 Date: 12/04/2026 17:33:36
*/


-- ----------------------------
-- Type structure for role
-- ----------------------------
DROP TYPE IF EXISTS "public"."role";
CREATE TYPE "public"."role" AS ENUM (
  'child',
  'youth',
  'elder'
);
ALTER TYPE "public"."role" OWNER TO "postgres";

-- ----------------------------
-- Table structure for detection_results
-- ----------------------------
DROP TABLE IF EXISTS "public"."detection_results";
CREATE TABLE "public"."detection_results" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "submission_id" uuid NOT NULL,
  "risk_level" text COLLATE "pg_catalog"."default",
  "fraud_type" text COLLATE "pg_catalog"."default",
  "result_detail" jsonb,
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Table structure for detection_submissions
-- ----------------------------
DROP TABLE IF EXISTS "public"."detection_submissions";
CREATE TABLE "public"."detection_submissions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "storage_batch_id" text COLLATE "pg_catalog"."default" NOT NULL,
  "has_text" bool NOT NULL DEFAULT false,
  "has_audio" bool NOT NULL DEFAULT false,
  "has_image" bool NOT NULL DEFAULT false,
  "has_video" bool NOT NULL DEFAULT false,
  "text_paths" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "audio_paths" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "image_paths" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "video_paths" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "text_content" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Table structure for users
-- ----------------------------
DROP TABLE IF EXISTS "public"."users";
CREATE TABLE "public"."users" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "phone" text COLLATE "pg_catalog"."default" NOT NULL,
  "password_hash" text COLLATE "pg_catalog"."default" NOT NULL,
  "birth_date" date NOT NULL,
  "role" "public"."role" NOT NULL,
  "display_name" text COLLATE "pg_catalog"."default" NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Primary Key structure for table detection_results
-- ----------------------------
ALTER TABLE "public"."detection_results" ADD CONSTRAINT "detection_results_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Primary Key structure for table detection_submissions
-- ----------------------------
ALTER TABLE "public"."detection_submissions" ADD CONSTRAINT "detection_submissions_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Uniques structure for table users
-- ----------------------------
ALTER TABLE "public"."users" ADD CONSTRAINT "users_phone_key" UNIQUE ("phone");

-- ----------------------------
-- Primary Key structure for table users
-- ----------------------------
ALTER TABLE "public"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Foreign Keys structure for table detection_results
-- ----------------------------
ALTER TABLE "public"."detection_results" ADD CONSTRAINT "detection_results_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."detection_submissions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table detection_submissions
-- ----------------------------
ALTER TABLE "public"."detection_submissions" ADD CONSTRAINT "detection_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
