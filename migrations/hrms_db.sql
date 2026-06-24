--
-- PostgreSQL database dump
--

-- Dumped from database version 15.4
-- Dumped by pg_dump version 15.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: notify_payroll_change(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.notify_payroll_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_notify('payroll_updated', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.notify_payroll_change() OWNER TO postgres;

--
-- Name: refresh_monthly_attendance_mv(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.refresh_monthly_attendance_mv() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_attendance;
EXCEPTION
  WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW mv_monthly_attendance;
END;
$$;


ALTER FUNCTION public.refresh_monthly_attendance_mv() OWNER TO postgres;

--
-- Name: refresh_monthly_attendance_view(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.refresh_monthly_attendance_view() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_attendance;
END;
$$;


ALTER FUNCTION public.refresh_monthly_attendance_view() OWNER TO postgres;

--
-- Name: refresh_payroll_summary(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.refresh_payroll_summary() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_payroll_monthly;
END;
$$;


ALTER FUNCTION public.refresh_payroll_summary() OWNER TO postgres;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.activity_logs (
    id integer NOT NULL,
    user_id integer,
    user_name character varying(255),
    role character varying(100),
    action character varying(100),
    action_type character varying(100),
    module_name character varying(100),
    details text,
    ip_address character varying(64),
    device_info text,
    branch character varying(100) DEFAULT 'all'::character varying,
    department character varying(100),
    severity character varying(20) DEFAULT 'info'::character varying,
    metadata jsonb DEFAULT '{}'::jsonb,
    "timestamp" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT activity_logs_severity_check CHECK (((severity)::text = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'error'::character varying, 'critical'::character varying])::text[])))
);


ALTER TABLE public.activity_logs OWNER TO postgres;

--
-- Name: activity_logs_backup_20260615; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.activity_logs_backup_20260615 (
    id integer,
    user_id integer,
    user_name character varying(255),
    role character varying(100),
    action character varying(100),
    action_type character varying(100),
    module_name character varying(100),
    details text,
    ip_address character varying(64),
    device_info text,
    branch character varying(100),
    department character varying(100),
    severity character varying(20),
    metadata jsonb,
    "timestamp" timestamp without time zone
);


ALTER TABLE public.activity_logs_backup_20260615 OWNER TO postgres;

--
-- Name: activity_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.activity_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.activity_logs_id_seq OWNER TO postgres;

--
-- Name: activity_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.activity_logs_id_seq OWNED BY public.activity_logs.id;


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance (
    id integer NOT NULL,
    user_id integer,
    date date NOT NULL,
    status character varying(20) DEFAULT 'present'::character varying NOT NULL,
    check_in time without time zone,
    check_out time without time zone
);


ALTER TABLE public.attendance OWNER TO postgres;

--
-- Name: attendance_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance_history (
    id integer NOT NULL,
    original_attendance_id integer,
    date date NOT NULL,
    employee_email character varying(100) NOT NULL,
    office_in time without time zone,
    office_out time without time zone,
    break_in time without time zone,
    break_out time without time zone,
    break_in_2 time without time zone,
    break_out_2 time without time zone,
    lunch_in time without time zone,
    lunch_out time without time zone,
    extra_break_ins jsonb DEFAULT '[]'::jsonb,
    extra_break_outs jsonb DEFAULT '[]'::jsonb,
    leave_type character varying(50),
    leave_status character varying(20),
    edited_by_email character varying(100) NOT NULL,
    edited_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    edit_reason text,
    snapshot_metadata jsonb DEFAULT '{}'::jsonb
);


ALTER TABLE public.attendance_history OWNER TO postgres;

--
-- Name: attendance_history_backup_20260615; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance_history_backup_20260615 (
    id integer,
    original_attendance_id integer,
    date date,
    employee_email character varying(100),
    office_in time without time zone,
    office_out time without time zone,
    break_in time without time zone,
    break_out time without time zone,
    break_in_2 time without time zone,
    break_out_2 time without time zone,
    lunch_in time without time zone,
    lunch_out time without time zone,
    extra_break_ins jsonb,
    extra_break_outs jsonb,
    leave_type character varying(50),
    leave_status character varying(20),
    edited_by_email character varying(100),
    edited_at timestamp without time zone,
    edit_reason text,
    snapshot_metadata jsonb
);


ALTER TABLE public.attendance_history_backup_20260615 OWNER TO postgres;

--
-- Name: attendance_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.attendance_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.attendance_history_id_seq OWNER TO postgres;

--
-- Name: attendance_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.attendance_history_id_seq OWNED BY public.attendance_history.id;


--
-- Name: attendance_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.attendance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.attendance_id_seq OWNER TO postgres;

--
-- Name: attendance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.attendance_id_seq OWNED BY public.attendance.id;


--
-- Name: attendance_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance_records (
    id integer NOT NULL,
    user_id integer NOT NULL,
    date date NOT NULL,
    check_in_time time without time zone,
    check_out_time time without time zone,
    status character varying(20) DEFAULT 'absent'::character varying,
    late_minutes integer DEFAULT 0,
    production_hours numeric(6,2) DEFAULT 0,
    total_break_minutes integer DEFAULT 0,
    extra_break_ins jsonb DEFAULT '[]'::jsonb,
    extra_break_outs jsonb DEFAULT '[]'::jsonb,
    leave_type character varying(50),
    leave_status character varying(20),
    paid_leave_reason text,
    branch character varying(50),
    department character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    half_day_slot character varying(10),
    post_login_idle_minutes integer DEFAULT 0,
    misuse_of_time boolean DEFAULT false,
    logged_by_user_id integer,
    submission_ip character varying(64),
    device_fingerprint text,
    proxy_attempt boolean DEFAULT false,
    is_paid_leave boolean DEFAULT false,
    leave_request_id integer,
    holiday_name character varying(255),
    last_edit_reason text,
    CONSTRAINT attendance_records_half_day_slot_check CHECK (((half_day_slot)::text = ANY ((ARRAY['SLOT_A'::character varying, 'SLOT_B'::character varying, 'INVALID'::character varying])::text[]))),
    CONSTRAINT attendance_records_leave_status_check CHECK (((leave_status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[]))),
    CONSTRAINT attendance_records_status_check CHECK (((status)::text = ANY ((ARRAY['full_day'::character varying, 'half_day'::character varying, 'absent'::character varying, 'leave'::character varying, 'holiday'::character varying, 'present'::character varying, 'late'::character varying])::text[])))
);


ALTER TABLE public.attendance_records OWNER TO postgres;

--
-- Name: attendance_records_backup_20260615; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance_records_backup_20260615 (
    id integer,
    user_id integer,
    date date,
    check_in_time time without time zone,
    check_out_time time without time zone,
    status character varying(20),
    late_minutes integer,
    production_hours numeric(6,2),
    total_break_minutes integer,
    extra_break_ins jsonb,
    extra_break_outs jsonb,
    leave_type character varying(50),
    leave_status character varying(20),
    paid_leave_reason text,
    branch character varying(50),
    department character varying(100),
    created_at timestamp without time zone,
    updated_at timestamp without time zone,
    half_day_slot character varying(10),
    post_login_idle_minutes integer,
    misuse_of_time boolean,
    logged_by_user_id integer,
    submission_ip character varying(64),
    device_fingerprint text,
    proxy_attempt boolean,
    is_paid_leave boolean,
    leave_request_id integer,
    holiday_name character varying(255)
);


ALTER TABLE public.attendance_records_backup_20260615 OWNER TO postgres;

--
-- Name: attendance_records_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.attendance_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.attendance_records_id_seq OWNER TO postgres;

--
-- Name: attendance_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.attendance_records_id_seq OWNED BY public.attendance_records.id;


--
-- Name: attendance_summaries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance_summaries (
    id integer NOT NULL,
    month character varying(7) NOT NULL,
    summary_json jsonb NOT NULL,
    saved_by character varying(100) NOT NULL,
    branch character varying(50) DEFAULT 'all'::character varying,
    version integer DEFAULT 1,
    saved_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.attendance_summaries OWNER TO postgres;

--
-- Name: attendance_summaries_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.attendance_summaries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.attendance_summaries_id_seq OWNER TO postgres;

--
-- Name: attendance_summaries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.attendance_summaries_id_seq OWNED BY public.attendance_summaries.id;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    user_id integer,
    user_name character varying(255),
    user_role character varying(100),
    module_name character varying(255),
    action_type character varying(255),
    target_id integer,
    target_name character varying(255),
    field_changed character varying(255),
    old_value text,
    new_value text,
    reason text,
    ip_address character varying(255),
    device_info text,
    status character varying(50) DEFAULT 'SUCCESS'::character varying,
    branch character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.audit_logs OWNER TO postgres;

--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.audit_logs_id_seq OWNER TO postgres;

--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: branches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.branches (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    city character varying(100),
    address text,
    phone character varying(20),
    email character varying(100),
    manager_id integer,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.branches OWNER TO postgres;

--
-- Name: branches_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.branches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.branches_id_seq OWNER TO postgres;

--
-- Name: branches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.branches_id_seq OWNED BY public.branches.id;


--
-- Name: breaks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.breaks (
    id integer NOT NULL,
    user_id integer,
    date date DEFAULT CURRENT_DATE NOT NULL,
    break_start time without time zone,
    break_end time without time zone,
    duration_minutes integer,
    break_type character varying(30) DEFAULT 'regular'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.breaks OWNER TO postgres;

--
-- Name: breaks_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.breaks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.breaks_id_seq OWNER TO postgres;

--
-- Name: breaks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.breaks_id_seq OWNED BY public.breaks.id;


--
-- Name: company_holidays; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.company_holidays (
    id integer NOT NULL,
    date date NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(50) DEFAULT 'holiday'::character varying,
    branch character varying(100) DEFAULT 'all'::character varying,
    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.company_holidays OWNER TO postgres;

--
-- Name: company_holidays_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.company_holidays_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.company_holidays_id_seq OWNER TO postgres;

--
-- Name: company_holidays_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.company_holidays_id_seq OWNED BY public.company_holidays.id;


--
-- Name: departments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.departments (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    branch character varying(50) DEFAULT 'All'::character varying,
    head_id integer,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.departments OWNER TO postgres;

--
-- Name: departments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.departments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.departments_id_seq OWNER TO postgres;

--
-- Name: departments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.departments_id_seq OWNED BY public.departments.id;


--
-- Name: dress_code_exemptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.dress_code_exemptions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    exemption_date date NOT NULL,
    reason text,
    approved_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.dress_code_exemptions OWNER TO postgres;

--
-- Name: dress_code_exemptions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.dress_code_exemptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.dress_code_exemptions_id_seq OWNER TO postgres;

--
-- Name: dress_code_exemptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.dress_code_exemptions_id_seq OWNED BY public.dress_code_exemptions.id;


--
-- Name: employee_breaks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_breaks (
    id integer NOT NULL,
    user_id integer NOT NULL,
    date date NOT NULL,
    break_type character varying(10) NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    duration_minutes integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    logged_by_user_id integer,
    department character varying(100),
    last_edit_reason text,
    edited_by_user_id integer,
    edited_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT employee_breaks_break_type_check CHECK (((break_type)::text = ANY ((ARRAY['break1'::character varying, 'lunch'::character varying, 'break2'::character varying, 'break3'::character varying])::text[])))
);


ALTER TABLE public.employee_breaks OWNER TO postgres;

--
-- Name: employee_breaks_backup_20260615; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_breaks_backup_20260615 (
    id integer,
    user_id integer,
    date date,
    break_type character varying(10),
    start_time time without time zone,
    end_time time without time zone,
    duration_minutes integer,
    created_at timestamp without time zone,
    updated_at timestamp without time zone,
    logged_by_user_id integer,
    department character varying(100)
);


ALTER TABLE public.employee_breaks_backup_20260615 OWNER TO postgres;

--
-- Name: employee_breaks_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.employee_breaks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.employee_breaks_id_seq OWNER TO postgres;

--
-- Name: employee_breaks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.employee_breaks_id_seq OWNED BY public.employee_breaks.id;


--
-- Name: employee_monthly_summary; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_monthly_summary (
    id integer NOT NULL,
    user_id integer NOT NULL,
    month character varying(7) NOT NULL,
    late_login_count integer DEFAULT 0,
    penalty_days integer DEFAULT 0,
    violation_count integer DEFAULT 0,
    summary_json jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.employee_monthly_summary OWNER TO postgres;

--
-- Name: employee_monthly_summary_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.employee_monthly_summary_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.employee_monthly_summary_id_seq OWNER TO postgres;

--
-- Name: employee_monthly_summary_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.employee_monthly_summary_id_seq OWNED BY public.employee_monthly_summary.id;


--
-- Name: leave_balance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.leave_balance (
    id integer NOT NULL,
    user_id integer NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    earned_leave_balance numeric(5,1) DEFAULT 0,
    earned_leave_used numeric(5,1) DEFAULT 0,
    last_accrual_date date,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    earned_leave_credited numeric(5,1) DEFAULT 0,
    balance numeric(5,1) DEFAULT 0,
    accrual_date date,
    sick_credited numeric(5,1) DEFAULT 0,
    sick_used numeric(5,1) DEFAULT 0,
    casual_credited numeric(5,1) DEFAULT 0,
    casual_used numeric(5,1) DEFAULT 0,
    paid_leave_credited numeric(5,1) DEFAULT 0,
    paid_leave_used numeric(5,1) DEFAULT 0,
    unpaid_leave_used numeric(5,1) DEFAULT 0
);


ALTER TABLE public.leave_balance OWNER TO postgres;

--
-- Name: leave_balance_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.leave_balance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.leave_balance_id_seq OWNER TO postgres;

--
-- Name: leave_balance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.leave_balance_id_seq OWNED BY public.leave_balance.id;


--
-- Name: leave_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.leave_requests (
    id integer NOT NULL,
    user_id integer NOT NULL,
    leave_type character varying(30) NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    days integer NOT NULL,
    reason text,
    status character varying(20) DEFAULT 'pending'::character varying,
    approved_by integer,
    approved_at timestamp without time zone,
    rejection_reason text,
    is_sudden boolean DEFAULT false,
    is_extension boolean DEFAULT false,
    penalty_days integer DEFAULT 0,
    medical_doc_url text,
    medical_verified boolean DEFAULT false,
    is_sat_or_mon boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    penalty_applied boolean DEFAULT false,
    medical_doc_submitted boolean DEFAULT false,
    is_paid_leave boolean DEFAULT false,
    balance_at_application numeric(5,1) DEFAULT 0,
    salary_deducted numeric(12,2) DEFAULT 0,
    is_earned_leave boolean DEFAULT false,
    leave_category character varying(20),
    paid_days numeric(5,1) DEFAULT 0,
    unpaid_days numeric(5,1) DEFAULT 0,
    include_sunday_penalty boolean DEFAULT false,
    policy_reason text,
    CONSTRAINT leave_requests_leave_category_check CHECK (((leave_category IS NULL) OR ((leave_category)::text = ANY ((ARRAY['Paid'::character varying, 'Unpaid'::character varying])::text[])))),
    CONSTRAINT leave_requests_leave_type_check CHECK (((leave_type)::text = ANY ((ARRAY['Paid'::character varying, 'Unpaid'::character varying])::text[]))),
    CONSTRAINT leave_requests_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))
);


ALTER TABLE public.leave_requests OWNER TO postgres;

--
-- Name: leave_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.leave_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.leave_requests_id_seq OWNER TO postgres;

--
-- Name: leave_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.leave_requests_id_seq OWNED BY public.leave_requests.id;


--
-- Name: leaves; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.leaves (
    id integer NOT NULL,
    user_id integer,
    leave_type character varying(30) DEFAULT 'paid'::character varying NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    days integer DEFAULT 1 NOT NULL,
    reason text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    approved_by integer,
    applied_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.leaves OWNER TO postgres;

--
-- Name: leaves_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.leaves_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.leaves_id_seq OWNER TO postgres;

--
-- Name: leaves_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.leaves_id_seq OWNED BY public.leaves.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    full_name character varying(100) NOT NULL,
    email character varying(100) NOT NULL,
    password character varying(255) NOT NULL,
    visible_password character varying(100),
    role character varying(20) NOT NULL,
    department character varying(100),
    branch character varying(50) NOT NULL,
    employee_code character varying(20),
    salary numeric(12,2) DEFAULT 0 NOT NULL,
    joining_date date DEFAULT CURRENT_DATE,
    status character varying(20) DEFAULT 'active'::character varying,
    profile_initials character varying(5),
    designation character varying(100),
    bank_name character varying(100),
    bank_account character varying(50),
    bank_ifsc character varying(20),
    aadhar_number character varying(12),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['SUPER_ADMIN'::character varying, 'MANAGER'::character varying, 'EMPLOYEE'::character varying])::text[]))),
    CONSTRAINT users_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: mv_monthly_attendance; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
--

CREATE MATERIALIZED VIEW public.mv_monthly_attendance AS
 SELECT u.id AS user_id,
    u.full_name,
    u.department,
    u.branch,
    (date_trunc('month'::text, (a.date)::timestamp without time zone))::date AS month_start,
    (count(*) FILTER (WHERE ((a.status)::text = 'full_day'::text)))::integer AS full_days,
    (count(*) FILTER (WHERE ((a.status)::text = 'half_day'::text)))::integer AS half_days,
    (count(*) FILTER (WHERE ((a.status)::text = 'absent'::text)))::integer AS absent_days,
    (count(*) FILTER (WHERE ((a.status)::text = 'leave'::text)))::integer AS leave_days,
    (count(*) FILTER (WHERE ((a.status)::text = 'holiday'::text)))::integer AS holiday_days,
    (count(*) FILTER (WHERE (a.late_minutes > 0)))::integer AS late_days,
    (COALESCE(sum(a.late_minutes) FILTER (WHERE (a.late_minutes > 0)), (0)::bigint))::integer AS total_late_minutes,
    (COALESCE(avg((a.check_in_time)::interval) FILTER (WHERE (a.check_in_time IS NOT NULL)), '00:00:00'::interval))::time without time zone AS avg_login_time,
    (COALESCE(avg((a.check_out_time)::interval) FILTER (WHERE (a.check_out_time IS NOT NULL)), '00:00:00'::interval))::time without time zone AS avg_logout_time,
    COALESCE(sum(a.production_hours), (0)::numeric) AS total_production_hours,
    (COALESCE(sum(a.total_break_minutes), (0)::bigint))::integer AS total_break_minutes,
    (COALESCE(round(avg(COALESCE(a.total_break_minutes, 0))), (0)::numeric))::integer AS avg_break_mins,
    (count(*) FILTER (WHERE (COALESCE(a.total_break_minutes, 0) > 60)))::integer AS break_exceeded_days,
    (count(*) FILTER (WHERE ((a.status)::text <> ALL ((ARRAY['holiday'::character varying, 'absent'::character varying])::text[]))))::integer AS worked_days
   FROM (public.attendance_records a
     JOIN public.users u ON ((u.id = a.user_id)))
  WHERE ((u.role)::text <> 'SUPER_ADMIN'::text)
  GROUP BY u.id, u.full_name, u.department, u.branch, ((date_trunc('month'::text, (a.date)::timestamp without time zone))::date)
  WITH NO DATA;


ALTER TABLE public.mv_monthly_attendance OWNER TO postgres;

--
-- Name: payslip_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payslip_records (
    id integer NOT NULL,
    user_id integer NOT NULL,
    month date NOT NULL,
    basic_salary numeric(12,2) NOT NULL,
    earned_basic numeric(12,2) DEFAULT 0,
    incentives numeric(12,2) DEFAULT 0,
    deductions numeric(12,2) DEFAULT 0,
    tax numeric(12,2) DEFAULT 0,
    net_pay numeric(12,2) NOT NULL,
    working_days numeric(5,2) NOT NULL,
    present_days numeric(5,2) NOT NULL,
    outstanding_amount numeric(12,2) DEFAULT 0,
    payment_status character varying(20) DEFAULT 'unpaid'::character varying,
    breakdown jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    unpaid_leave_days numeric(5,1) DEFAULT 0,
    leave_deduction numeric(10,2) DEFAULT 0,
    penalty_days numeric(5,1) DEFAULT 0,
    penalty_deduction numeric(10,2) DEFAULT 0,
    CONSTRAINT payslip_records_payment_status_check CHECK (((payment_status)::text = ANY ((ARRAY['paid'::character varying, 'unpaid'::character varying])::text[])))
);


ALTER TABLE public.payslip_records OWNER TO postgres;

--
-- Name: mv_payroll_monthly; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
--

CREATE MATERIALIZED VIEW public.mv_payroll_monthly AS
 SELECT p.month,
    u.branch,
    u.department,
    count(*) AS employee_count,
    sum(p.basic_salary) AS total_ctc,
    sum(p.net_pay) AS total_payout,
    sum(p.deductions) AS total_deductions,
    sum(p.incentives) AS total_incentives,
    sum(p.tax) AS total_tax,
    round(avg(p.net_pay), 2) AS avg_net_pay,
    count(*) FILTER (WHERE ((p.payment_status)::text = 'paid'::text)) AS paid_count,
    count(*) FILTER (WHERE ((p.payment_status)::text = 'unpaid'::text)) AS unpaid_count
   FROM (public.payslip_records p
     JOIN public.users u ON ((p.user_id = u.id)))
  GROUP BY p.month, u.branch, u.department
  WITH NO DATA;


ALTER TABLE public.mv_payroll_monthly OWNER TO postgres;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    action_type character varying(50) NOT NULL,
    description text NOT NULL,
    related_id integer,
    target_role character varying(20) NOT NULL,
    is_read boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT notifications_target_role_check CHECK (((target_role)::text = ANY ((ARRAY['SUPER_ADMIN'::character varying, 'MANAGER'::character varying, 'BOTH'::character varying])::text[])))
);


ALTER TABLE public.notifications OWNER TO postgres;

--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.notifications_id_seq OWNER TO postgres;

--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: offer_letter_actions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.offer_letter_actions (
    id integer NOT NULL,
    offer_letter_id integer,
    action character varying(50),
    action_by_email character varying(150),
    ip_address character varying(50),
    user_agent text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.offer_letter_actions OWNER TO postgres;

--
-- Name: offer_letter_actions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.offer_letter_actions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.offer_letter_actions_id_seq OWNER TO postgres;

--
-- Name: offer_letter_actions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.offer_letter_actions_id_seq OWNED BY public.offer_letter_actions.id;


--
-- Name: offer_letter_audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.offer_letter_audit_logs (
    id integer NOT NULL,
    offer_letter_id integer,
    action_type character varying(50) NOT NULL,
    performed_by integer NOT NULL,
    performed_role character varying(50),
    old_status character varying(30),
    new_status character varying(30),
    remarks text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.offer_letter_audit_logs OWNER TO postgres;

--
-- Name: offer_letter_audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.offer_letter_audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.offer_letter_audit_logs_id_seq OWNER TO postgres;

--
-- Name: offer_letter_audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.offer_letter_audit_logs_id_seq OWNED BY public.offer_letter_audit_logs.id;


--
-- Name: offer_letter_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.offer_letter_templates (
    id integer NOT NULL,
    template_name character varying(100) NOT NULL,
    template_html text NOT NULL,
    is_active boolean DEFAULT true,
    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.offer_letter_templates OWNER TO postgres;

--
-- Name: offer_letter_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.offer_letter_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.offer_letter_templates_id_seq OWNER TO postgres;

--
-- Name: offer_letter_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.offer_letter_templates_id_seq OWNED BY public.offer_letter_templates.id;


--
-- Name: offer_letters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.offer_letters (
    id integer NOT NULL,
    employee_id integer,
    candidate_name character varying(150) NOT NULL,
    candidate_email character varying(150) NOT NULL,
    candidate_address text,
    designation character varying(100) NOT NULL,
    department character varying(100) NOT NULL,
    offer_date date NOT NULL,
    joining_date date NOT NULL,
    salary numeric(12,2),
    ctc numeric(12,2),
    branch character varying(100),
    location character varying(100),
    reporting_manager character varying(150),
    reference_number character varying(100),
    status character varying(30) DEFAULT 'DRAFT'::character varying,
    created_by integer NOT NULL,
    updated_by integer,
    pdf_url text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.offer_letters OWNER TO postgres;

--
-- Name: offer_letters_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.offer_letters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.offer_letters_id_seq OWNER TO postgres;

--
-- Name: offer_letters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.offer_letters_id_seq OWNED BY public.offer_letters.id;


--
-- Name: payroll; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payroll (
    id integer NOT NULL,
    user_id integer,
    month integer NOT NULL,
    year integer NOT NULL,
    basic_salary numeric(10,2) DEFAULT 0,
    hra numeric(10,2) DEFAULT 0,
    transport numeric(10,2) DEFAULT 0,
    other_allowances numeric(10,2) DEFAULT 0,
    pf_deduction numeric(10,2) DEFAULT 0,
    tax_deduction numeric(10,2) DEFAULT 0,
    other_deductions numeric(10,2) DEFAULT 0,
    gross_salary numeric(10,2) DEFAULT 0,
    net_salary numeric(10,2) DEFAULT 0,
    working_days integer DEFAULT 26,
    present_days integer DEFAULT 26,
    status character varying(20) DEFAULT 'draft'::character varying,
    generated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.payroll OWNER TO postgres;

--
-- Name: payroll_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.payroll_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.payroll_id_seq OWNER TO postgres;

--
-- Name: payroll_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.payroll_id_seq OWNED BY public.payroll.id;


--
-- Name: payslip_records_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.payslip_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.payslip_records_id_seq OWNER TO postgres;

--
-- Name: payslip_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.payslip_records_id_seq OWNED BY public.payslip_records.id;


--
-- Name: phone_deposit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.phone_deposit_log (
    id integer NOT NULL,
    user_id integer NOT NULL,
    deposited_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    collected_at timestamp without time zone,
    deposited_by integer,
    collected_by integer,
    notes text
);


ALTER TABLE public.phone_deposit_log OWNER TO postgres;

--
-- Name: phone_deposit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.phone_deposit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.phone_deposit_log_id_seq OWNER TO postgres;

--
-- Name: phone_deposit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.phone_deposit_log_id_seq OWNED BY public.phone_deposit_log.id;


--
-- Name: policy_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.policy_config (
    config_key character varying(100) NOT NULL,
    config_value character varying(255) NOT NULL,
    description text,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.policy_config OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: violation_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.violation_records (
    id integer NOT NULL,
    user_id integer NOT NULL,
    violation_type character varying(20) NOT NULL,
    violation_date date DEFAULT CURRENT_DATE NOT NULL,
    recorded_by integer,
    action_taken text,
    related_user_id integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    penalty_attendance_status character varying(20),
    penalty_days numeric(5,1) DEFAULT 0,
    CONSTRAINT violation_penalty_attendance_status_check CHECK (((penalty_attendance_status IS NULL) OR ((penalty_attendance_status)::text = ANY ((ARRAY['half_day'::character varying, 'absent'::character varying])::text[])))),
    CONSTRAINT violation_records_violation_type_check CHECK (((violation_type)::text = ANY ((ARRAY['PHONE'::character varying, 'DRESS_CODE'::character varying, 'PROXY_LOG'::character varying, 'MISUSE_TIME'::character varying, 'OTHER'::character varying])::text[])))
);


ALTER TABLE public.violation_records OWNER TO postgres;

--
-- Name: violation_records_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.violation_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.violation_records_id_seq OWNER TO postgres;

--
-- Name: violation_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.violation_records_id_seq OWNED BY public.violation_records.id;


--
-- Name: activity_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_logs ALTER COLUMN id SET DEFAULT nextval('public.activity_logs_id_seq'::regclass);


--
-- Name: attendance id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance ALTER COLUMN id SET DEFAULT nextval('public.attendance_id_seq'::regclass);


--
-- Name: attendance_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_history ALTER COLUMN id SET DEFAULT nextval('public.attendance_history_id_seq'::regclass);


--
-- Name: attendance_records id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_records ALTER COLUMN id SET DEFAULT nextval('public.attendance_records_id_seq'::regclass);


--
-- Name: attendance_summaries id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_summaries ALTER COLUMN id SET DEFAULT nextval('public.attendance_summaries_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: branches id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches ALTER COLUMN id SET DEFAULT nextval('public.branches_id_seq'::regclass);


--
-- Name: breaks id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.breaks ALTER COLUMN id SET DEFAULT nextval('public.breaks_id_seq'::regclass);


--
-- Name: company_holidays id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.company_holidays ALTER COLUMN id SET DEFAULT nextval('public.company_holidays_id_seq'::regclass);


--
-- Name: departments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departments ALTER COLUMN id SET DEFAULT nextval('public.departments_id_seq'::regclass);


--
-- Name: dress_code_exemptions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dress_code_exemptions ALTER COLUMN id SET DEFAULT nextval('public.dress_code_exemptions_id_seq'::regclass);


--
-- Name: employee_breaks id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_breaks ALTER COLUMN id SET DEFAULT nextval('public.employee_breaks_id_seq'::regclass);


--
-- Name: employee_monthly_summary id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_monthly_summary ALTER COLUMN id SET DEFAULT nextval('public.employee_monthly_summary_id_seq'::regclass);


--
-- Name: leave_balance id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leave_balance ALTER COLUMN id SET DEFAULT nextval('public.leave_balance_id_seq'::regclass);


--
-- Name: leave_requests id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leave_requests ALTER COLUMN id SET DEFAULT nextval('public.leave_requests_id_seq'::regclass);


--
-- Name: leaves id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leaves ALTER COLUMN id SET DEFAULT nextval('public.leaves_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: offer_letter_actions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offer_letter_actions ALTER COLUMN id SET DEFAULT nextval('public.offer_letter_actions_id_seq'::regclass);


--
-- Name: offer_letter_audit_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offer_letter_audit_logs ALTER COLUMN id SET DEFAULT nextval('public.offer_letter_audit_logs_id_seq'::regclass);


--
-- Name: offer_letter_templates id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offer_letter_templates ALTER COLUMN id SET DEFAULT nextval('public.offer_letter_templates_id_seq'::regclass);


--
-- Name: offer_letters id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offer_letters ALTER COLUMN id SET DEFAULT nextval('public.offer_letters_id_seq'::regclass);


--
-- Name: payroll id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payroll ALTER COLUMN id SET DEFAULT nextval('public.payroll_id_seq'::regclass);


--
-- Name: payslip_records id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payslip_records ALTER COLUMN id SET DEFAULT nextval('public.payslip_records_id_seq'::regclass);


--
-- Name: phone_deposit_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.phone_deposit_log ALTER COLUMN id SET DEFAULT nextval('public.phone_deposit_log_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: violation_records id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.violation_records ALTER COLUMN id SET DEFAULT nextval('public.violation_records_id_seq'::regclass);


--
-- Data for Name: activity_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.activity_logs VALUES (1, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Hyderabad Manager — ₹18,666.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 8}', '2026-05-30 16:57:53.03187');
INSERT INTO public.activity_logs VALUES (2, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹18,666.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 9}', '2026-05-30 16:57:53.062137');
INSERT INTO public.activity_logs VALUES (3, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Arjun Mehta — ₹17,500', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 10}', '2026-05-30 16:57:53.067132');
INSERT INTO public.activity_logs VALUES (4, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Kapoor — ₹8,166.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 11}', '2026-05-30 16:57:53.071967');
INSERT INTO public.activity_logs VALUES (5, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rohan Desai — ₹14,466.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 12}', '2026-05-30 16:57:53.077181');
INSERT INTO public.activity_logs VALUES (6, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Nair — ₹13,533.31', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 13}', '2026-05-30 16:57:53.082353');
INSERT INTO public.activity_logs VALUES (7, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Ramesh Kumar — ₹12,833.31', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 14}', '2026-05-30 16:57:53.086733');
INSERT INTO public.activity_logs VALUES (8, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Suresh Reddy — ₹11,200', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 15}', '2026-05-30 16:57:53.090855');
INSERT INTO public.activity_logs VALUES (9, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Neha Agarwal — ₹14,000', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 16}', '2026-05-30 16:57:53.09483');
INSERT INTO public.activity_logs VALUES (10, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Vikram Gupta — ₹16,800', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 17}', '2026-05-30 16:57:53.100815');
INSERT INTO public.activity_logs VALUES (11, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Divya Reddy — ₹12,600', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 18}', '2026-05-30 16:57:53.104549');
INSERT INTO public.activity_logs VALUES (12, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sneha Reddy — ₹12,833.31', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 19}', '2026-05-30 16:57:53.108428');
INSERT INTO public.activity_logs VALUES (13, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rajesh Khanna — ₹17,500', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 20}', '2026-05-30 16:57:53.112101');
INSERT INTO public.activity_logs VALUES (14, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Sharma — ₹12,133.31', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 21}', '2026-05-30 16:57:53.115533');
INSERT INTO public.activity_logs VALUES (15, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Anjali Nair — ₹15,866.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 22}', '2026-05-30 16:57:53.119412');
INSERT INTO public.activity_logs VALUES (16, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Devansh Nair — ₹16,566.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 23}', '2026-05-30 16:57:53.123295');
INSERT INTO public.activity_logs VALUES (17, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Praveen Kumar — ₹13,766.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 24}', '2026-05-30 16:57:53.127101');
INSERT INTO public.activity_logs VALUES (18, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Lakshmi S — ₹13,066.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 25}', '2026-05-30 16:57:53.131217');
INSERT INTO public.activity_logs VALUES (19, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sanjay P — ₹14,700', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 26}', '2026-05-30 16:57:53.134542');
INSERT INTO public.activity_logs VALUES (20, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Nidhi Agarwal — ₹14,233.31', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 27}', '2026-05-30 16:57:53.138694');
INSERT INTO public.activity_logs VALUES (21, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Roy — ₹8,866.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 28}', '2026-05-30 16:57:53.142969');
INSERT INTO public.activity_logs VALUES (22, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Hyderabad Manager — ₹18,064.55', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 29}', '2026-05-30 16:58:08.479555');
INSERT INTO public.activity_logs VALUES (23, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹18,064.55', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 30}', '2026-05-30 16:58:08.484831');
INSERT INTO public.activity_logs VALUES (24, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Arjun Mehta — ₹16,935.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 31}', '2026-05-30 16:58:08.488465');
INSERT INTO public.activity_logs VALUES (25, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Kapoor — ₹7,903.21', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 32}', '2026-05-30 16:58:08.492901');
INSERT INTO public.activity_logs VALUES (26, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rohan Desai — ₹14,000', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 33}', '2026-05-30 16:58:08.497105');
INSERT INTO public.activity_logs VALUES (27, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Nair — ₹13,096.79', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 34}', '2026-05-30 16:58:08.500827');
INSERT INTO public.activity_logs VALUES (28, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Ramesh Kumar — ₹12,419.33', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 35}', '2026-05-30 16:58:08.504293');
INSERT INTO public.activity_logs VALUES (29, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Suresh Reddy — ₹10,838.73', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 36}', '2026-05-30 16:58:08.507946');
INSERT INTO public.activity_logs VALUES (30, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Neha Agarwal — ₹13,548.36', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 37}', '2026-05-30 16:58:08.512751');
INSERT INTO public.activity_logs VALUES (31, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Vikram Gupta — ₹16,258.06', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 38}', '2026-05-30 16:58:08.51607');
INSERT INTO public.activity_logs VALUES (32, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Divya Reddy — ₹12,193.58', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 39}', '2026-05-30 16:58:08.519237');
INSERT INTO public.activity_logs VALUES (33, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sneha Reddy — ₹12,419.33', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 40}', '2026-05-30 16:58:08.52222');
INSERT INTO public.activity_logs VALUES (34, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rajesh Khanna — ₹16,935.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 41}', '2026-05-30 16:58:08.526853');
INSERT INTO public.activity_logs VALUES (35, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Sharma — ₹11,741.94', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 42}', '2026-05-30 16:58:08.530298');
INSERT INTO public.activity_logs VALUES (36, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Anjali Nair — ₹15,354.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 43}', '2026-05-30 16:58:08.533448');
INSERT INTO public.activity_logs VALUES (37, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Devansh Nair — ₹16,032.24', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 44}', '2026-05-30 16:58:08.536818');
INSERT INTO public.activity_logs VALUES (38, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Praveen Kumar — ₹13,322.61', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 45}', '2026-05-30 16:58:08.540452');
INSERT INTO public.activity_logs VALUES (39, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Lakshmi S — ₹12,645.15', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 46}', '2026-05-30 16:58:08.544873');
INSERT INTO public.activity_logs VALUES (40, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sanjay P — ₹14,225.82', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 47}', '2026-05-30 16:58:08.548648');
INSERT INTO public.activity_logs VALUES (41, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Nidhi Agarwal — ₹13,774.18', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 48}', '2026-05-30 16:58:08.554688');
INSERT INTO public.activity_logs VALUES (42, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Roy — ₹8,580.67', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 49}', '2026-05-30 16:58:08.559522');
INSERT INTO public.activity_logs VALUES (43, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Anjali Nair — ₹15,354.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 50}', '2026-05-30 21:16:19.967173');
INSERT INTO public.activity_logs VALUES (44, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Hyderabad Manager — ₹18,064.55', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 1}', '2026-05-30 22:34:37.045331');
INSERT INTO public.activity_logs VALUES (45, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹18,064.55', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 2}', '2026-05-30 22:34:37.064512');
INSERT INTO public.activity_logs VALUES (46, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Arjun Mehta — ₹16,935.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 3}', '2026-05-30 22:34:37.073014');
INSERT INTO public.activity_logs VALUES (47, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Kapoor — ₹7,903.21', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 4}', '2026-05-30 22:34:37.082325');
INSERT INTO public.activity_logs VALUES (48, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rohan Desai — ₹14,000', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 5}', '2026-05-30 22:34:37.088929');
INSERT INTO public.activity_logs VALUES (49, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Nair — ₹13,096.79', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 56}', '2026-05-30 22:34:37.097722');
INSERT INTO public.activity_logs VALUES (50, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Ramesh Kumar — ₹12,419.33', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 57}', '2026-05-30 22:34:37.105068');
INSERT INTO public.activity_logs VALUES (51, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Suresh Reddy — ₹10,838.73', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 58}', '2026-05-30 22:34:37.112885');
INSERT INTO public.activity_logs VALUES (52, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Neha Agarwal — ₹13,548.36', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 59}', '2026-05-30 22:34:37.119693');
INSERT INTO public.activity_logs VALUES (53, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Vikram Gupta — ₹16,258.06', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 60}', '2026-05-30 22:34:37.126007');
INSERT INTO public.activity_logs VALUES (54, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Divya Reddy — ₹12,193.58', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 61}', '2026-05-30 22:34:37.133098');
INSERT INTO public.activity_logs VALUES (55, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sneha Reddy — ₹12,419.33', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 6}', '2026-05-30 22:34:37.138375');
INSERT INTO public.activity_logs VALUES (56, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rajesh Khanna — ₹16,935.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 7}', '2026-05-30 22:34:37.143709');
INSERT INTO public.activity_logs VALUES (57, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Sharma — ₹11,741.94', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 64}', '2026-05-30 22:34:37.150069');
INSERT INTO public.activity_logs VALUES (58, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Anjali Nair — ₹15,354.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 50}', '2026-05-30 22:34:37.155672');
INSERT INTO public.activity_logs VALUES (59, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Devansh Nair — ₹16,032.24', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 66}', '2026-05-30 22:34:37.162032');
INSERT INTO public.activity_logs VALUES (60, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Praveen Kumar — ₹13,322.61', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 67}', '2026-05-30 22:34:37.167917');
INSERT INTO public.activity_logs VALUES (61, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Lakshmi S — ₹12,645.15', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 68}', '2026-05-30 22:34:37.174794');
INSERT INTO public.activity_logs VALUES (62, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sanjay P — ₹14,225.82', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 69}', '2026-05-30 22:34:37.181497');
INSERT INTO public.activity_logs VALUES (63, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Nidhi Agarwal — ₹13,774.18', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 70}', '2026-05-30 22:34:37.187388');
INSERT INTO public.activity_logs VALUES (64, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Roy — ₹8,580.67', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 71}', '2026-05-30 22:34:37.193547');
INSERT INTO public.activity_logs VALUES (65, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Hyderabad Manager — ₹18,064.55', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 29}', '2026-05-30 22:34:46.643429');
INSERT INTO public.activity_logs VALUES (66, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹18,064.55', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 30}', '2026-05-30 22:34:46.652713');
INSERT INTO public.activity_logs VALUES (67, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Arjun Mehta — ₹16,935.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 31}', '2026-05-30 22:34:46.660918');
INSERT INTO public.activity_logs VALUES (68, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Kapoor — ₹7,903.21', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 32}', '2026-05-30 22:34:46.668293');
INSERT INTO public.activity_logs VALUES (69, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rohan Desai — ₹14,000', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 33}', '2026-05-30 22:34:46.673327');
INSERT INTO public.activity_logs VALUES (70, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Nair — ₹13,096.79', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 34}', '2026-05-30 22:34:46.679789');
INSERT INTO public.activity_logs VALUES (71, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Ramesh Kumar — ₹12,419.33', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 35}', '2026-05-30 22:34:46.685627');
INSERT INTO public.activity_logs VALUES (72, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Suresh Reddy — ₹10,838.73', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 36}', '2026-05-30 22:34:46.691364');
INSERT INTO public.activity_logs VALUES (73, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Neha Agarwal — ₹13,548.36', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 37}', '2026-05-30 22:34:46.697741');
INSERT INTO public.activity_logs VALUES (74, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Vikram Gupta — ₹16,258.06', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 38}', '2026-05-30 22:34:46.703372');
INSERT INTO public.activity_logs VALUES (75, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Divya Reddy — ₹12,193.58', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 39}', '2026-05-30 22:34:46.708592');
INSERT INTO public.activity_logs VALUES (76, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sneha Reddy — ₹12,419.33', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 40}', '2026-05-30 22:34:46.716866');
INSERT INTO public.activity_logs VALUES (77, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rajesh Khanna — ₹16,935.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 41}', '2026-05-30 22:34:46.721869');
INSERT INTO public.activity_logs VALUES (78, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Sharma — ₹11,741.94', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 42}', '2026-05-30 22:34:46.726769');
INSERT INTO public.activity_logs VALUES (79, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Anjali Nair — ₹15,354.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 43}', '2026-05-30 22:34:46.733043');
INSERT INTO public.activity_logs VALUES (80, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Devansh Nair — ₹16,032.24', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 44}', '2026-05-30 22:34:46.73925');
INSERT INTO public.activity_logs VALUES (81, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Praveen Kumar — ₹13,322.61', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 45}', '2026-05-30 22:34:46.747123');
INSERT INTO public.activity_logs VALUES (82, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Lakshmi S — ₹12,645.15', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 46}', '2026-05-30 22:34:46.752694');
INSERT INTO public.activity_logs VALUES (83, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sanjay P — ₹14,225.82', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 47}', '2026-05-30 22:34:46.75761');
INSERT INTO public.activity_logs VALUES (84, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Nidhi Agarwal — ₹13,774.18', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 48}', '2026-05-30 22:34:46.763342');
INSERT INTO public.activity_logs VALUES (85, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Roy — ₹8,580.67', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 49}', '2026-05-30 22:34:46.77157');
INSERT INTO public.activity_logs VALUES (86, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Hyderabad Manager — ₹14,285.7', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 93}', '2026-05-30 22:35:01.521206');
INSERT INTO public.activity_logs VALUES (87, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹14,285.7', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 94}', '2026-05-30 22:35:01.528121');
INSERT INTO public.activity_logs VALUES (88, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Arjun Mehta — ₹13,392.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 95}', '2026-05-30 22:35:01.534142');
INSERT INTO public.activity_logs VALUES (89, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Kapoor — ₹6,250', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 96}', '2026-05-30 22:35:01.538471');
INSERT INTO public.activity_logs VALUES (90, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rohan Desai — ₹11,071.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 97}', '2026-05-30 22:35:01.542912');
INSERT INTO public.activity_logs VALUES (91, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Nair — ₹10,357.15', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 98}', '2026-05-30 22:35:01.54789');
INSERT INTO public.activity_logs VALUES (92, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Ramesh Kumar — ₹9,821.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 99}', '2026-05-30 22:35:01.552825');
INSERT INTO public.activity_logs VALUES (93, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Suresh Reddy — ₹8,571.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 100}', '2026-05-30 22:35:01.556982');
INSERT INTO public.activity_logs VALUES (94, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Neha Agarwal — ₹10,714.3', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 101}', '2026-05-30 22:35:01.563146');
INSERT INTO public.activity_logs VALUES (95, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Vikram Gupta — ₹12,857.15', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 102}', '2026-05-30 22:35:01.570059');
INSERT INTO public.activity_logs VALUES (96, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Divya Reddy — ₹9,642.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 103}', '2026-05-30 22:35:01.574022');
INSERT INTO public.activity_logs VALUES (97, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sneha Reddy — ₹9,821.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 104}', '2026-05-30 22:35:01.578216');
INSERT INTO public.activity_logs VALUES (98, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rajesh Khanna — ₹13,392.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 105}', '2026-05-30 22:35:01.583346');
INSERT INTO public.activity_logs VALUES (99, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Sharma — ₹9,285.7', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 106}', '2026-05-30 22:35:01.587355');
INSERT INTO public.activity_logs VALUES (100, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Anjali Nair — ₹12,142.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 107}', '2026-05-30 22:35:01.591036');
INSERT INTO public.activity_logs VALUES (101, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Devansh Nair — ₹12,678.55', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 108}', '2026-05-30 22:35:01.594713');
INSERT INTO public.activity_logs VALUES (102, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Praveen Kumar — ₹10,535.7', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 109}', '2026-05-30 22:35:01.599163');
INSERT INTO public.activity_logs VALUES (103, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Lakshmi S — ₹10,000', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 110}', '2026-05-30 22:35:01.605829');
INSERT INTO public.activity_logs VALUES (104, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sanjay P — ₹11,250', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 111}', '2026-05-30 22:35:01.609261');
INSERT INTO public.activity_logs VALUES (105, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Nidhi Agarwal — ₹10,892.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 112}', '2026-05-30 22:35:01.613345');
INSERT INTO public.activity_logs VALUES (106, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Roy — ₹6,785.7', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 113}', '2026-05-30 22:35:01.617841');
INSERT INTO public.activity_logs VALUES (107, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Hyderabad Manager — ₹12,903.25', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 114}', '2026-05-30 22:36:06.724783');
INSERT INTO public.activity_logs VALUES (108, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹12,903.25', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 115}', '2026-05-30 22:36:06.747661');
INSERT INTO public.activity_logs VALUES (109, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Arjun Mehta — ₹12,096.75', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 116}', '2026-05-30 22:36:06.751627');
INSERT INTO public.activity_logs VALUES (110, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Kapoor — ₹5,645.15', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 117}', '2026-05-30 22:36:06.757957');
INSERT INTO public.activity_logs VALUES (111, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rohan Desai — ₹10,000', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 118}', '2026-05-30 22:36:06.762219');
INSERT INTO public.activity_logs VALUES (112, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Nair — ₹9,354.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 119}', '2026-05-30 22:36:06.767508');
INSERT INTO public.activity_logs VALUES (113, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Ramesh Kumar — ₹8,870.95', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 120}', '2026-05-30 22:36:06.772407');
INSERT INTO public.activity_logs VALUES (114, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Suresh Reddy — ₹7,741.95', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 121}', '2026-05-30 22:36:06.776801');
INSERT INTO public.activity_logs VALUES (115, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Neha Agarwal — ₹9,677.4', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 122}', '2026-05-30 22:36:06.779989');
INSERT INTO public.activity_logs VALUES (116, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Vikram Gupta — ₹11,612.9', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 123}', '2026-05-30 22:36:06.783141');
INSERT INTO public.activity_logs VALUES (117, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Divya Reddy — ₹8,709.7', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 124}', '2026-05-30 22:36:06.788349');
INSERT INTO public.activity_logs VALUES (118, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sneha Reddy — ₹8,870.95', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 125}', '2026-05-30 22:36:06.793687');
INSERT INTO public.activity_logs VALUES (119, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rajesh Khanna — ₹12,096.75', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 126}', '2026-05-30 22:36:06.797838');
INSERT INTO public.activity_logs VALUES (120, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Sharma — ₹8,387.1', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 127}', '2026-05-30 22:36:06.803225');
INSERT INTO public.activity_logs VALUES (121, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Anjali Nair — ₹10,967.75', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 128}', '2026-05-30 22:36:06.810644');
INSERT INTO public.activity_logs VALUES (122, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Devansh Nair — ₹11,451.6', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 129}', '2026-05-30 22:36:06.814493');
INSERT INTO public.activity_logs VALUES (123, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Praveen Kumar — ₹9,516.15', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 130}', '2026-05-30 22:36:06.819763');
INSERT INTO public.activity_logs VALUES (124, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Lakshmi S — ₹9,032.25', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 131}', '2026-05-30 22:36:06.824709');
INSERT INTO public.activity_logs VALUES (125, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sanjay P — ₹10,161.3', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 132}', '2026-05-30 22:36:06.82814');
INSERT INTO public.activity_logs VALUES (126, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Nidhi Agarwal — ₹9,838.7', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 133}', '2026-05-30 22:36:06.83174');
INSERT INTO public.activity_logs VALUES (127, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Roy — ₹6,129.05', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 134}', '2026-05-30 22:36:06.836857');
INSERT INTO public.activity_logs VALUES (128, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹13,333.35', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 135}', '2026-06-01 14:40:35.361227');
INSERT INTO public.activity_logs VALUES (129, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Arjun Mehta — ₹12,500', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 136}', '2026-06-01 22:28:39.839129');
INSERT INTO public.activity_logs VALUES (130, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹10,666.58', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 135}', '2026-06-01 23:02:29.607034');
INSERT INTO public.activity_logs VALUES (131, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sanjay P — ₹8,400', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 138}', '2026-06-02 15:42:45.248528');
INSERT INTO public.activity_logs VALUES (132, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹3,870.96', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 12:07:27.396106');
INSERT INTO public.activity_logs VALUES (133, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹17,419.32', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 12:33:34.45792');
INSERT INTO public.activity_logs VALUES (134, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹17,419.32', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 12:33:53.433159');
INSERT INTO public.activity_logs VALUES (135, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹20,000.1', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 142}', '2026-06-04 12:34:04.645753');
INSERT INTO public.activity_logs VALUES (136, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹20,000.1', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 142}', '2026-06-04 12:54:30.367177');
INSERT INTO public.activity_logs VALUES (137, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹17,419.32', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 13:00:07.390168');
INSERT INTO public.activity_logs VALUES (138, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹20,000.1', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 142}', '2026-06-04 13:00:36.172333');
INSERT INTO public.activity_logs VALUES (139, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹20,000.1', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 142}', '2026-06-04 13:08:08.011312');
INSERT INTO public.activity_logs VALUES (140, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹17,419.32', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 13:08:22.811632');
INSERT INTO public.activity_logs VALUES (141, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹18,666.76', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 148}', '2026-06-04 13:09:24.907239');
INSERT INTO public.activity_logs VALUES (142, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹16,129', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 149}', '2026-06-04 13:09:46.07314');
INSERT INTO public.activity_logs VALUES (143, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹19,677.38', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 13:23:39.16755');
INSERT INTO public.activity_logs VALUES (144, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹17,333.42', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 148}', '2026-06-04 14:03:43.670099');
INSERT INTO public.activity_logs VALUES (145, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹17,419.32', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 149}', '2026-06-04 14:09:18.577508');
INSERT INTO public.activity_logs VALUES (146, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹16,774.16', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 149}', '2026-06-04 14:42:25.895171');
INSERT INTO public.activity_logs VALUES (147, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹19,677.38', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 18:03:13.841474');
INSERT INTO public.activity_logs VALUES (148, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹19,677.38', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 18:10:57.455522');
INSERT INTO public.activity_logs VALUES (149, 1, 'Super Admin', 'SUPER_ADMIN', 'BREAK_EDITED', 'UPDATE', 'Breaks', 'Breaks edited for Priyanka Vaddi (priyanka.vaddi@vjcoverseas.com) on 2026-06-16. Old value: {}. New value: {&quot;break1&quot;:{&quot;start_time&quot;:null,&quot;end_time&quot;:null,&quot;duration_minutes&quot;:0},&quot;break2&quot;:{&quot;start_time&quot;:null,&quot;end_time&quot;:null,&quot;duration_minutes&quot;:0},&quot;break3&quot;:{&quot;start_time&quot;:null,&quot;end_time&quot;:null,&quot;duration_minutes&quot;:0},&quot;lunch&quot;:{&quot;start_time&quot;:null,&quot;end_time&quot;:null,&quot;duration_minutes&quot;:0}}. Reason: power off', '::ffff:127.0.0.1', NULL, 'Hyderabad', 'Process Team', 'warning', '{"date": "2026-06-16", "reason": "power off", "newValues": {"lunch": {"end_time": null, "start_time": null, "duration_minutes": 0}, "break1": {"end_time": null, "start_time": null, "duration_minutes": 0}, "break2": {"end_time": null, "start_time": null, "duration_minutes": 0}, "break3": {"end_time": null, "start_time": null, "duration_minutes": 0}}, "oldValues": {}, "employeeId": 24, "editedRecordId": [106, 108, 109, 107]}', '2026-06-16 10:28:31.192738');
INSERT INTO public.activity_logs VALUES (150, 1, 'Super Admin', 'SUPER_ADMIN', 'ATTENDANCE_EDITED', 'UPDATE', 'Attendance', 'Attendance edited for Vikram Gupta (vikram.gupta@vjc.com) on 2026-06-16. Reason: no laptop.', '::ffff:127.0.0.1', NULL, 'Hyderabad', 'IT Department', 'warning', '{"date": "2026-06-16", "reason": "no laptop", "editedBy": {"id": 1, "name": "Super Admin", "role": "SUPER_ADMIN", "email": "admin@hrms.com"}, "editedFor": {"id": 11, "name": "Vikram Gupta", "email": "vikram.gupta@vjc.com"}, "newValues": {"status": "half_day", "check_in_time": "10:00:00", "check_out_time": "18:00:00"}, "oldValues": {"status": null, "check_in_time": null, "check_out_time": null}, "editedRecordId": 241}', '2026-06-16 10:39:48.04076');
INSERT INTO public.activity_logs VALUES (151, 2, 'Hyderabad Manager', 'MANAGER', 'ATTENDANCE_EDITED', 'UPDATE', 'Attendance', 'Attendance edited for Hyderabad Manager (manager.hyd@hrms.com) on 2026-06-16. Reason: power cut.', '::ffff:127.0.0.1', NULL, 'Hyderabad', 'Branch Manager', 'warning', '{"date": "2026-06-16", "reason": "power cut", "editedBy": {"id": 2, "name": "Hyderabad Manager", "role": "MANAGER", "email": "manager.hyd@hrms.com"}, "editedFor": {"id": 2, "name": "Hyderabad Manager", "email": "manager.hyd@hrms.com"}, "newValues": {"status": "half_day", "check_in_time": "09:00:00", "check_out_time": "18:00:00"}, "oldValues": {"status": null, "check_in_time": null, "check_out_time": null}, "editedRecordId": 242}', '2026-06-16 10:53:31.241489');
INSERT INTO public.activity_logs VALUES (152, 1, 'Super Admin', 'SUPER_ADMIN', 'EMPLOYEE_MARKED_INACTIVE', 'UPDATE', 'Employee', 'Super Admin marked Nidhi Agarwal (nidhi.agarwal@vjc.com) inactive.', '::ffff:127.0.0.1', NULL, 'Bangalore', 'Accounts', 'warning', '{"editedBy": {"id": 1, "name": "Super Admin", "role": "SUPER_ADMIN", "email": "admin@hrms.com"}, "editedFor": {"id": 21, "name": "Nidhi Agarwal", "email": "nidhi.agarwal@vjc.com"}, "newValues": {"status": "inactive"}, "oldValues": {"status": "active"}}', '2026-06-16 11:13:49.982905');
INSERT INTO public.activity_logs VALUES (153, 1, 'Super Admin', 'SUPER_ADMIN', 'EMPLOYEE_MARKED_INACTIVE', 'UPDATE', 'Employee', 'Super Admin marked Nidhi Agarwal (nidhi.agarwal@vjc.com) inactive.', '::ffff:127.0.0.1', NULL, 'Bangalore', 'Accounts', 'warning', '{"editedBy": {"id": 1, "name": "Super Admin", "role": "SUPER_ADMIN", "email": "admin@hrms.com"}, "editedFor": {"id": 21, "name": "Nidhi Agarwal", "email": "nidhi.agarwal@vjc.com"}, "newValues": {"status": "inactive"}, "oldValues": {"status": "inactive"}}', '2026-06-16 11:14:01.70232');


--
-- Data for Name: activity_logs_backup_20260615; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.activity_logs_backup_20260615 VALUES (1, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Hyderabad Manager — ₹18,666.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 8}', '2026-05-30 16:57:53.03187');
INSERT INTO public.activity_logs_backup_20260615 VALUES (2, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹18,666.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 9}', '2026-05-30 16:57:53.062137');
INSERT INTO public.activity_logs_backup_20260615 VALUES (3, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Arjun Mehta — ₹17,500', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 10}', '2026-05-30 16:57:53.067132');
INSERT INTO public.activity_logs_backup_20260615 VALUES (4, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Kapoor — ₹8,166.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 11}', '2026-05-30 16:57:53.071967');
INSERT INTO public.activity_logs_backup_20260615 VALUES (5, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rohan Desai — ₹14,466.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 12}', '2026-05-30 16:57:53.077181');
INSERT INTO public.activity_logs_backup_20260615 VALUES (6, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Nair — ₹13,533.31', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 13}', '2026-05-30 16:57:53.082353');
INSERT INTO public.activity_logs_backup_20260615 VALUES (7, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Ramesh Kumar — ₹12,833.31', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 14}', '2026-05-30 16:57:53.086733');
INSERT INTO public.activity_logs_backup_20260615 VALUES (8, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Suresh Reddy — ₹11,200', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 15}', '2026-05-30 16:57:53.090855');
INSERT INTO public.activity_logs_backup_20260615 VALUES (9, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Neha Agarwal — ₹14,000', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 16}', '2026-05-30 16:57:53.09483');
INSERT INTO public.activity_logs_backup_20260615 VALUES (10, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Vikram Gupta — ₹16,800', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 17}', '2026-05-30 16:57:53.100815');
INSERT INTO public.activity_logs_backup_20260615 VALUES (11, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Divya Reddy — ₹12,600', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 18}', '2026-05-30 16:57:53.104549');
INSERT INTO public.activity_logs_backup_20260615 VALUES (12, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sneha Reddy — ₹12,833.31', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 19}', '2026-05-30 16:57:53.108428');
INSERT INTO public.activity_logs_backup_20260615 VALUES (13, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rajesh Khanna — ₹17,500', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 20}', '2026-05-30 16:57:53.112101');
INSERT INTO public.activity_logs_backup_20260615 VALUES (14, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Sharma — ₹12,133.31', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 21}', '2026-05-30 16:57:53.115533');
INSERT INTO public.activity_logs_backup_20260615 VALUES (15, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Anjali Nair — ₹15,866.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 22}', '2026-05-30 16:57:53.119412');
INSERT INTO public.activity_logs_backup_20260615 VALUES (16, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Devansh Nair — ₹16,566.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 23}', '2026-05-30 16:57:53.123295');
INSERT INTO public.activity_logs_backup_20260615 VALUES (17, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Praveen Kumar — ₹13,766.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 24}', '2026-05-30 16:57:53.127101');
INSERT INTO public.activity_logs_backup_20260615 VALUES (18, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Lakshmi S — ₹13,066.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 25}', '2026-05-30 16:57:53.131217');
INSERT INTO public.activity_logs_backup_20260615 VALUES (19, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sanjay P — ₹14,700', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 26}', '2026-05-30 16:57:53.134542');
INSERT INTO public.activity_logs_backup_20260615 VALUES (20, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Nidhi Agarwal — ₹14,233.31', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 27}', '2026-05-30 16:57:53.138694');
INSERT INTO public.activity_logs_backup_20260615 VALUES (21, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Roy — ₹8,866.69', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 28}', '2026-05-30 16:57:53.142969');
INSERT INTO public.activity_logs_backup_20260615 VALUES (22, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Hyderabad Manager — ₹18,064.55', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 29}', '2026-05-30 16:58:08.479555');
INSERT INTO public.activity_logs_backup_20260615 VALUES (23, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹18,064.55', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 30}', '2026-05-30 16:58:08.484831');
INSERT INTO public.activity_logs_backup_20260615 VALUES (24, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Arjun Mehta — ₹16,935.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 31}', '2026-05-30 16:58:08.488465');
INSERT INTO public.activity_logs_backup_20260615 VALUES (25, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Kapoor — ₹7,903.21', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 32}', '2026-05-30 16:58:08.492901');
INSERT INTO public.activity_logs_backup_20260615 VALUES (26, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rohan Desai — ₹14,000', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 33}', '2026-05-30 16:58:08.497105');
INSERT INTO public.activity_logs_backup_20260615 VALUES (27, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Nair — ₹13,096.79', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 34}', '2026-05-30 16:58:08.500827');
INSERT INTO public.activity_logs_backup_20260615 VALUES (28, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Ramesh Kumar — ₹12,419.33', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 35}', '2026-05-30 16:58:08.504293');
INSERT INTO public.activity_logs_backup_20260615 VALUES (29, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Suresh Reddy — ₹10,838.73', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 36}', '2026-05-30 16:58:08.507946');
INSERT INTO public.activity_logs_backup_20260615 VALUES (30, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Neha Agarwal — ₹13,548.36', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 37}', '2026-05-30 16:58:08.512751');
INSERT INTO public.activity_logs_backup_20260615 VALUES (31, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Vikram Gupta — ₹16,258.06', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 38}', '2026-05-30 16:58:08.51607');
INSERT INTO public.activity_logs_backup_20260615 VALUES (32, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Divya Reddy — ₹12,193.58', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 39}', '2026-05-30 16:58:08.519237');
INSERT INTO public.activity_logs_backup_20260615 VALUES (33, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sneha Reddy — ₹12,419.33', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 40}', '2026-05-30 16:58:08.52222');
INSERT INTO public.activity_logs_backup_20260615 VALUES (34, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rajesh Khanna — ₹16,935.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 41}', '2026-05-30 16:58:08.526853');
INSERT INTO public.activity_logs_backup_20260615 VALUES (35, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Sharma — ₹11,741.94', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 42}', '2026-05-30 16:58:08.530298');
INSERT INTO public.activity_logs_backup_20260615 VALUES (36, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Anjali Nair — ₹15,354.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 43}', '2026-05-30 16:58:08.533448');
INSERT INTO public.activity_logs_backup_20260615 VALUES (37, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Devansh Nair — ₹16,032.24', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 44}', '2026-05-30 16:58:08.536818');
INSERT INTO public.activity_logs_backup_20260615 VALUES (38, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Praveen Kumar — ₹13,322.61', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 45}', '2026-05-30 16:58:08.540452');
INSERT INTO public.activity_logs_backup_20260615 VALUES (39, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Lakshmi S — ₹12,645.15', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 46}', '2026-05-30 16:58:08.544873');
INSERT INTO public.activity_logs_backup_20260615 VALUES (40, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sanjay P — ₹14,225.82', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 47}', '2026-05-30 16:58:08.548648');
INSERT INTO public.activity_logs_backup_20260615 VALUES (41, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Nidhi Agarwal — ₹13,774.18', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 48}', '2026-05-30 16:58:08.554688');
INSERT INTO public.activity_logs_backup_20260615 VALUES (42, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Roy — ₹8,580.67', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 49}', '2026-05-30 16:58:08.559522');
INSERT INTO public.activity_logs_backup_20260615 VALUES (43, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Anjali Nair — ₹15,354.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 50}', '2026-05-30 21:16:19.967173');
INSERT INTO public.activity_logs_backup_20260615 VALUES (44, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Hyderabad Manager — ₹18,064.55', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 1}', '2026-05-30 22:34:37.045331');
INSERT INTO public.activity_logs_backup_20260615 VALUES (45, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹18,064.55', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 2}', '2026-05-30 22:34:37.064512');
INSERT INTO public.activity_logs_backup_20260615 VALUES (46, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Arjun Mehta — ₹16,935.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 3}', '2026-05-30 22:34:37.073014');
INSERT INTO public.activity_logs_backup_20260615 VALUES (47, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Kapoor — ₹7,903.21', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 4}', '2026-05-30 22:34:37.082325');
INSERT INTO public.activity_logs_backup_20260615 VALUES (48, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rohan Desai — ₹14,000', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 5}', '2026-05-30 22:34:37.088929');
INSERT INTO public.activity_logs_backup_20260615 VALUES (49, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Nair — ₹13,096.79', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 56}', '2026-05-30 22:34:37.097722');
INSERT INTO public.activity_logs_backup_20260615 VALUES (50, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Ramesh Kumar — ₹12,419.33', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 57}', '2026-05-30 22:34:37.105068');
INSERT INTO public.activity_logs_backup_20260615 VALUES (51, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Suresh Reddy — ₹10,838.73', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 58}', '2026-05-30 22:34:37.112885');
INSERT INTO public.activity_logs_backup_20260615 VALUES (52, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Neha Agarwal — ₹13,548.36', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 59}', '2026-05-30 22:34:37.119693');
INSERT INTO public.activity_logs_backup_20260615 VALUES (53, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Vikram Gupta — ₹16,258.06', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 60}', '2026-05-30 22:34:37.126007');
INSERT INTO public.activity_logs_backup_20260615 VALUES (54, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Divya Reddy — ₹12,193.58', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 61}', '2026-05-30 22:34:37.133098');
INSERT INTO public.activity_logs_backup_20260615 VALUES (55, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sneha Reddy — ₹12,419.33', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 6}', '2026-05-30 22:34:37.138375');
INSERT INTO public.activity_logs_backup_20260615 VALUES (56, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rajesh Khanna — ₹16,935.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 7}', '2026-05-30 22:34:37.143709');
INSERT INTO public.activity_logs_backup_20260615 VALUES (57, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Sharma — ₹11,741.94', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 64}', '2026-05-30 22:34:37.150069');
INSERT INTO public.activity_logs_backup_20260615 VALUES (58, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Anjali Nair — ₹15,354.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 50}', '2026-05-30 22:34:37.155672');
INSERT INTO public.activity_logs_backup_20260615 VALUES (59, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Devansh Nair — ₹16,032.24', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 66}', '2026-05-30 22:34:37.162032');
INSERT INTO public.activity_logs_backup_20260615 VALUES (60, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Praveen Kumar — ₹13,322.61', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 67}', '2026-05-30 22:34:37.167917');
INSERT INTO public.activity_logs_backup_20260615 VALUES (61, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Lakshmi S — ₹12,645.15', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 68}', '2026-05-30 22:34:37.174794');
INSERT INTO public.activity_logs_backup_20260615 VALUES (62, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sanjay P — ₹14,225.82', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 69}', '2026-05-30 22:34:37.181497');
INSERT INTO public.activity_logs_backup_20260615 VALUES (63, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Nidhi Agarwal — ₹13,774.18', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 70}', '2026-05-30 22:34:37.187388');
INSERT INTO public.activity_logs_backup_20260615 VALUES (64, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Roy — ₹8,580.67', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 71}', '2026-05-30 22:34:37.193547');
INSERT INTO public.activity_logs_backup_20260615 VALUES (65, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Hyderabad Manager — ₹18,064.55', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 29}', '2026-05-30 22:34:46.643429');
INSERT INTO public.activity_logs_backup_20260615 VALUES (66, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹18,064.55', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 30}', '2026-05-30 22:34:46.652713');
INSERT INTO public.activity_logs_backup_20260615 VALUES (67, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Arjun Mehta — ₹16,935.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 31}', '2026-05-30 22:34:46.660918');
INSERT INTO public.activity_logs_backup_20260615 VALUES (68, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Kapoor — ₹7,903.21', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 32}', '2026-05-30 22:34:46.668293');
INSERT INTO public.activity_logs_backup_20260615 VALUES (69, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rohan Desai — ₹14,000', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 33}', '2026-05-30 22:34:46.673327');
INSERT INTO public.activity_logs_backup_20260615 VALUES (70, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Nair — ₹13,096.79', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 34}', '2026-05-30 22:34:46.679789');
INSERT INTO public.activity_logs_backup_20260615 VALUES (71, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Ramesh Kumar — ₹12,419.33', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 35}', '2026-05-30 22:34:46.685627');
INSERT INTO public.activity_logs_backup_20260615 VALUES (72, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Suresh Reddy — ₹10,838.73', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 36}', '2026-05-30 22:34:46.691364');
INSERT INTO public.activity_logs_backup_20260615 VALUES (73, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Neha Agarwal — ₹13,548.36', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 37}', '2026-05-30 22:34:46.697741');
INSERT INTO public.activity_logs_backup_20260615 VALUES (74, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Vikram Gupta — ₹16,258.06', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 38}', '2026-05-30 22:34:46.703372');
INSERT INTO public.activity_logs_backup_20260615 VALUES (75, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Divya Reddy — ₹12,193.58', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 39}', '2026-05-30 22:34:46.708592');
INSERT INTO public.activity_logs_backup_20260615 VALUES (76, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sneha Reddy — ₹12,419.33', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 40}', '2026-05-30 22:34:46.716866');
INSERT INTO public.activity_logs_backup_20260615 VALUES (77, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rajesh Khanna — ₹16,935.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 41}', '2026-05-30 22:34:46.721869');
INSERT INTO public.activity_logs_backup_20260615 VALUES (78, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Sharma — ₹11,741.94', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 42}', '2026-05-30 22:34:46.726769');
INSERT INTO public.activity_logs_backup_20260615 VALUES (79, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Anjali Nair — ₹15,354.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 43}', '2026-05-30 22:34:46.733043');
INSERT INTO public.activity_logs_backup_20260615 VALUES (80, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Devansh Nair — ₹16,032.24', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 44}', '2026-05-30 22:34:46.73925');
INSERT INTO public.activity_logs_backup_20260615 VALUES (81, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Praveen Kumar — ₹13,322.61', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 45}', '2026-05-30 22:34:46.747123');
INSERT INTO public.activity_logs_backup_20260615 VALUES (82, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Lakshmi S — ₹12,645.15', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 46}', '2026-05-30 22:34:46.752694');
INSERT INTO public.activity_logs_backup_20260615 VALUES (83, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sanjay P — ₹14,225.82', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 47}', '2026-05-30 22:34:46.75761');
INSERT INTO public.activity_logs_backup_20260615 VALUES (84, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Nidhi Agarwal — ₹13,774.18', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 48}', '2026-05-30 22:34:46.763342');
INSERT INTO public.activity_logs_backup_20260615 VALUES (85, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Roy — ₹8,580.67', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 49}', '2026-05-30 22:34:46.77157');
INSERT INTO public.activity_logs_backup_20260615 VALUES (86, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Hyderabad Manager — ₹14,285.7', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 93}', '2026-05-30 22:35:01.521206');
INSERT INTO public.activity_logs_backup_20260615 VALUES (87, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹14,285.7', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 94}', '2026-05-30 22:35:01.528121');
INSERT INTO public.activity_logs_backup_20260615 VALUES (88, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Arjun Mehta — ₹13,392.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 95}', '2026-05-30 22:35:01.534142');
INSERT INTO public.activity_logs_backup_20260615 VALUES (89, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Kapoor — ₹6,250', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 96}', '2026-05-30 22:35:01.538471');
INSERT INTO public.activity_logs_backup_20260615 VALUES (90, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rohan Desai — ₹11,071.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 97}', '2026-05-30 22:35:01.542912');
INSERT INTO public.activity_logs_backup_20260615 VALUES (91, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Nair — ₹10,357.15', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 98}', '2026-05-30 22:35:01.54789');
INSERT INTO public.activity_logs_backup_20260615 VALUES (92, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Ramesh Kumar — ₹9,821.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 99}', '2026-05-30 22:35:01.552825');
INSERT INTO public.activity_logs_backup_20260615 VALUES (93, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Suresh Reddy — ₹8,571.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 100}', '2026-05-30 22:35:01.556982');
INSERT INTO public.activity_logs_backup_20260615 VALUES (94, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Neha Agarwal — ₹10,714.3', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 101}', '2026-05-30 22:35:01.563146');
INSERT INTO public.activity_logs_backup_20260615 VALUES (95, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Vikram Gupta — ₹12,857.15', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 102}', '2026-05-30 22:35:01.570059');
INSERT INTO public.activity_logs_backup_20260615 VALUES (96, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Divya Reddy — ₹9,642.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 103}', '2026-05-30 22:35:01.574022');
INSERT INTO public.activity_logs_backup_20260615 VALUES (97, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sneha Reddy — ₹9,821.45', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 104}', '2026-05-30 22:35:01.578216');
INSERT INTO public.activity_logs_backup_20260615 VALUES (98, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rajesh Khanna — ₹13,392.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 105}', '2026-05-30 22:35:01.583346');
INSERT INTO public.activity_logs_backup_20260615 VALUES (99, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Sharma — ₹9,285.7', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 106}', '2026-05-30 22:35:01.587355');
INSERT INTO public.activity_logs_backup_20260615 VALUES (100, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Anjali Nair — ₹12,142.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 107}', '2026-05-30 22:35:01.591036');
INSERT INTO public.activity_logs_backup_20260615 VALUES (101, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Devansh Nair — ₹12,678.55', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 108}', '2026-05-30 22:35:01.594713');
INSERT INTO public.activity_logs_backup_20260615 VALUES (102, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Praveen Kumar — ₹10,535.7', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 109}', '2026-05-30 22:35:01.599163');
INSERT INTO public.activity_logs_backup_20260615 VALUES (103, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Lakshmi S — ₹10,000', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 110}', '2026-05-30 22:35:01.605829');
INSERT INTO public.activity_logs_backup_20260615 VALUES (104, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sanjay P — ₹11,250', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 111}', '2026-05-30 22:35:01.609261');
INSERT INTO public.activity_logs_backup_20260615 VALUES (105, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Nidhi Agarwal — ₹10,892.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 112}', '2026-05-30 22:35:01.613345');
INSERT INTO public.activity_logs_backup_20260615 VALUES (106, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Roy — ₹6,785.7', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 113}', '2026-05-30 22:35:01.617841');
INSERT INTO public.activity_logs_backup_20260615 VALUES (107, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Hyderabad Manager — ₹12,903.25', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 114}', '2026-05-30 22:36:06.724783');
INSERT INTO public.activity_logs_backup_20260615 VALUES (108, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹12,903.25', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 115}', '2026-05-30 22:36:06.747661');
INSERT INTO public.activity_logs_backup_20260615 VALUES (109, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Arjun Mehta — ₹12,096.75', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 116}', '2026-05-30 22:36:06.751627');
INSERT INTO public.activity_logs_backup_20260615 VALUES (110, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Kapoor — ₹5,645.15', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 117}', '2026-05-30 22:36:06.757957');
INSERT INTO public.activity_logs_backup_20260615 VALUES (111, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rohan Desai — ₹10,000', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 118}', '2026-05-30 22:36:06.762219');
INSERT INTO public.activity_logs_backup_20260615 VALUES (112, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Nair — ₹9,354.85', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 119}', '2026-05-30 22:36:06.767508');
INSERT INTO public.activity_logs_backup_20260615 VALUES (113, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Ramesh Kumar — ₹8,870.95', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 120}', '2026-05-30 22:36:06.772407');
INSERT INTO public.activity_logs_backup_20260615 VALUES (114, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Suresh Reddy — ₹7,741.95', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 121}', '2026-05-30 22:36:06.776801');
INSERT INTO public.activity_logs_backup_20260615 VALUES (115, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Neha Agarwal — ₹9,677.4', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 122}', '2026-05-30 22:36:06.779989');
INSERT INTO public.activity_logs_backup_20260615 VALUES (116, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Vikram Gupta — ₹11,612.9', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 123}', '2026-05-30 22:36:06.783141');
INSERT INTO public.activity_logs_backup_20260615 VALUES (117, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Divya Reddy — ₹8,709.7', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 124}', '2026-05-30 22:36:06.788349');
INSERT INTO public.activity_logs_backup_20260615 VALUES (118, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sneha Reddy — ₹8,870.95', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 125}', '2026-05-30 22:36:06.793687');
INSERT INTO public.activity_logs_backup_20260615 VALUES (119, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Rajesh Khanna — ₹12,096.75', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 126}', '2026-05-30 22:36:06.797838');
INSERT INTO public.activity_logs_backup_20260615 VALUES (120, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priya Sharma — ₹8,387.1', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 127}', '2026-05-30 22:36:06.803225');
INSERT INTO public.activity_logs_backup_20260615 VALUES (121, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Anjali Nair — ₹10,967.75', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 128}', '2026-05-30 22:36:06.810644');
INSERT INTO public.activity_logs_backup_20260615 VALUES (122, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Devansh Nair — ₹11,451.6', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 129}', '2026-05-30 22:36:06.814493');
INSERT INTO public.activity_logs_backup_20260615 VALUES (123, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Praveen Kumar — ₹9,516.15', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 130}', '2026-05-30 22:36:06.819763');
INSERT INTO public.activity_logs_backup_20260615 VALUES (124, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Lakshmi S — ₹9,032.25', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 131}', '2026-05-30 22:36:06.824709');
INSERT INTO public.activity_logs_backup_20260615 VALUES (125, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sanjay P — ₹10,161.3', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 132}', '2026-05-30 22:36:06.82814');
INSERT INTO public.activity_logs_backup_20260615 VALUES (126, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Nidhi Agarwal — ₹9,838.7', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 133}', '2026-05-30 22:36:06.83174');
INSERT INTO public.activity_logs_backup_20260615 VALUES (127, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Kavita Roy — ₹6,129.05', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 134}', '2026-05-30 22:36:06.836857');
INSERT INTO public.activity_logs_backup_20260615 VALUES (128, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹13,333.35', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 135}', '2026-06-01 14:40:35.361227');
INSERT INTO public.activity_logs_backup_20260615 VALUES (129, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Arjun Mehta — ₹12,500', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 136}', '2026-06-01 22:28:39.839129');
INSERT INTO public.activity_logs_backup_20260615 VALUES (130, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Bangalore Manager — ₹10,666.58', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 135}', '2026-06-01 23:02:29.607034');
INSERT INTO public.activity_logs_backup_20260615 VALUES (131, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Sanjay P — ₹8,400', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 138}', '2026-06-02 15:42:45.248528');
INSERT INTO public.activity_logs_backup_20260615 VALUES (132, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹3,870.96', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 12:07:27.396106');
INSERT INTO public.activity_logs_backup_20260615 VALUES (133, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹17,419.32', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 12:33:34.45792');
INSERT INTO public.activity_logs_backup_20260615 VALUES (134, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹17,419.32', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 12:33:53.433159');
INSERT INTO public.activity_logs_backup_20260615 VALUES (135, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹20,000.1', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 142}', '2026-06-04 12:34:04.645753');
INSERT INTO public.activity_logs_backup_20260615 VALUES (136, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹20,000.1', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 142}', '2026-06-04 12:54:30.367177');
INSERT INTO public.activity_logs_backup_20260615 VALUES (137, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹17,419.32', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 13:00:07.390168');
INSERT INTO public.activity_logs_backup_20260615 VALUES (138, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹20,000.1', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 142}', '2026-06-04 13:00:36.172333');
INSERT INTO public.activity_logs_backup_20260615 VALUES (139, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹20,000.1', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 142}', '2026-06-04 13:08:08.011312');
INSERT INTO public.activity_logs_backup_20260615 VALUES (140, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹17,419.32', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 13:08:22.811632');
INSERT INTO public.activity_logs_backup_20260615 VALUES (141, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹18,666.76', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 148}', '2026-06-04 13:09:24.907239');
INSERT INTO public.activity_logs_backup_20260615 VALUES (142, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹16,129', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 149}', '2026-06-04 13:09:46.07314');
INSERT INTO public.activity_logs_backup_20260615 VALUES (143, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹19,677.38', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 13:23:39.16755');
INSERT INTO public.activity_logs_backup_20260615 VALUES (144, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹17,333.42', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 148}', '2026-06-04 14:03:43.670099');
INSERT INTO public.activity_logs_backup_20260615 VALUES (145, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹17,419.32', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 149}', '2026-06-04 14:09:18.577508');
INSERT INTO public.activity_logs_backup_20260615 VALUES (146, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹16,774.16', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 149}', '2026-06-04 14:42:25.895171');
INSERT INTO public.activity_logs_backup_20260615 VALUES (147, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹19,677.38', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 18:03:13.841474');
INSERT INTO public.activity_logs_backup_20260615 VALUES (148, 1, 'Super Admin', 'SUPER_ADMIN', 'PayslipGen', NULL, NULL, 'Payslip generated for Priyanka Vaddi — ₹19,677.38', '::ffff:127.0.0.1', NULL, 'Corporate', NULL, 'info', '{"payslipId": 139}', '2026-06-04 18:10:57.455522');


--
-- Data for Name: attendance; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.attendance VALUES (687, 6, '2026-05-11', 'late', '10:25:00', '18:35:00');
INSERT INTO public.attendance VALUES (694, 13, '2026-05-11', 'late', '10:25:00', '18:35:00');
INSERT INTO public.attendance VALUES (700, 19, '2026-05-11', 'late', '10:25:00', '18:35:00');
INSERT INTO public.attendance VALUES (702, 21, '2026-05-11', 'late', '10:25:00', '18:35:00');
INSERT INTO public.attendance VALUES (706, 4, '2026-05-12', 'late', '10:28:00', '18:40:00');
INSERT INTO public.attendance VALUES (709, 7, '2026-05-12', 'late', '10:28:00', '18:40:00');
INSERT INTO public.attendance VALUES (712, 10, '2026-05-12', 'late', '10:28:00', '18:40:00');
INSERT INTO public.attendance VALUES (714, 12, '2026-05-12', 'late', '10:28:00', '18:40:00');
INSERT INTO public.attendance VALUES (721, 19, '2026-05-12', 'late', '10:28:00', '18:40:00');
INSERT INTO public.attendance VALUES (727, 4, '2026-05-13', 'late', '10:23:00', '18:30:00');
INSERT INTO public.attendance VALUES (739, 16, '2026-05-13', 'late', '10:23:00', '18:30:00');
INSERT INTO public.attendance VALUES (750, 6, '2026-05-14', 'late', '10:20:00', '18:25:00');
INSERT INTO public.attendance VALUES (753, 9, '2026-05-14', 'late', '10:20:00', '18:25:00');
INSERT INTO public.attendance VALUES (754, 10, '2026-05-14', 'late', '10:20:00', '18:25:00');
INSERT INTO public.attendance VALUES (765, 21, '2026-05-14', 'late', '10:20:00', '18:25:00');
INSERT INTO public.attendance VALUES (769, 4, '2026-05-15', 'late', '10:26:00', '18:45:00');
INSERT INTO public.attendance VALUES (770, 5, '2026-05-15', 'late', '10:26:00', '18:45:00');
INSERT INTO public.attendance VALUES (771, 6, '2026-05-15', 'late', '10:26:00', '18:45:00');
INSERT INTO public.attendance VALUES (777, 12, '2026-05-15', 'late', '10:26:00', '18:45:00');
INSERT INTO public.attendance VALUES (778, 13, '2026-05-15', 'late', '10:26:00', '18:45:00');
INSERT INTO public.attendance VALUES (782, 17, '2026-05-15', 'late', '10:26:00', '18:45:00');
INSERT INTO public.attendance VALUES (794, 8, '2026-05-17', 'late', '10:36:00', '18:21:00');
INSERT INTO public.attendance VALUES (802, 16, '2026-05-17', 'late', '10:32:00', '19:03:00');
INSERT INTO public.attendance VALUES (803, 17, '2026-05-17', 'late', '10:24:00', '18:53:00');
INSERT INTO public.attendance VALUES (806, 20, '2026-05-17', 'late', '10:18:00', '18:16:00');
INSERT INTO public.attendance VALUES (2, 1, '2026-05-02', 'present', '09:02:00', '18:17:00');
INSERT INTO public.attendance VALUES (4, 1, '2026-05-04', 'present', '09:12:00', '18:15:00');
INSERT INTO public.attendance VALUES (5, 1, '2026-05-05', 'present', '09:50:00', '18:55:00');
INSERT INTO public.attendance VALUES (6, 1, '2026-05-06', 'present', '09:05:00', '18:08:00');
INSERT INTO public.attendance VALUES (7, 1, '2026-05-07', 'present', '09:00:00', '18:03:00');
INSERT INTO public.attendance VALUES (8, 1, '2026-05-08', 'present', '09:13:00', '18:19:00');
INSERT INTO public.attendance VALUES (18, 1, '2026-05-18', 'present', '09:42:00', '18:59:00');
INSERT INTO public.attendance VALUES (19, 1, '2026-05-19', 'present', '09:13:00', '18:00:00');
INSERT INTO public.attendance VALUES (20, 1, '2026-05-20', 'present', '09:06:00', '13:02:00');
INSERT INTO public.attendance VALUES (21, 1, '2026-05-21', 'present', '09:07:00', '18:01:00');
INSERT INTO public.attendance VALUES (22, 1, '2026-05-22', 'present', '09:05:00', '13:08:00');
INSERT INTO public.attendance VALUES (23, 1, '2026-05-23', 'present', '09:02:00', '18:00:00');
INSERT INTO public.attendance VALUES (25, 1, '2026-05-25', 'present', '09:06:00', '18:02:00');
INSERT INTO public.attendance VALUES (27, 1, '2026-05-27', 'present', '09:46:00', '18:54:00');
INSERT INTO public.attendance VALUES (28, 1, '2026-05-28', 'present', '09:09:00', '18:11:00');
INSERT INTO public.attendance VALUES (29, 1, '2026-05-29', 'present', '09:00:00', '18:08:00');
INSERT INTO public.attendance VALUES (33, 2, '2026-05-02', 'present', '09:10:00', '18:18:00');
INSERT INTO public.attendance VALUES (35, 2, '2026-05-04', 'present', '09:03:00', '18:16:00');
INSERT INTO public.attendance VALUES (36, 2, '2026-05-05', 'present', '09:09:00', '13:04:00');
INSERT INTO public.attendance VALUES (37, 2, '2026-05-06', 'present', '09:10:00', '18:20:00');
INSERT INTO public.attendance VALUES (38, 2, '2026-05-07', 'present', '09:30:00', '18:53:00');
INSERT INTO public.attendance VALUES (47, 2, '2026-05-16', 'present', '09:10:00', '18:10:00');
INSERT INTO public.attendance VALUES (49, 2, '2026-05-18', 'present', '09:01:00', '18:27:00');
INSERT INTO public.attendance VALUES (50, 2, '2026-05-19', 'present', '09:09:00', '18:27:00');
INSERT INTO public.attendance VALUES (51, 2, '2026-05-20', 'present', '09:02:00', '18:11:00');
INSERT INTO public.attendance VALUES (52, 2, '2026-05-21', 'present', '09:07:00', '18:09:00');
INSERT INTO public.attendance VALUES (53, 2, '2026-05-22', 'present', '09:09:00', '18:01:00');
INSERT INTO public.attendance VALUES (54, 2, '2026-05-23', 'present', '09:09:00', '18:19:00');
INSERT INTO public.attendance VALUES (56, 2, '2026-05-25', 'present', '09:04:00', '18:20:00');
INSERT INTO public.attendance VALUES (60, 2, '2026-05-29', 'present', '09:02:00', '13:10:00');
INSERT INTO public.attendance VALUES (61, 2, '2026-05-30', 'present', '09:07:00', '18:17:00');
INSERT INTO public.attendance VALUES (64, 3, '2026-05-02', 'present', '09:13:00', '18:06:00');
INSERT INTO public.attendance VALUES (66, 3, '2026-05-04', 'present', '09:12:00', '18:26:00');
INSERT INTO public.attendance VALUES (67, 3, '2026-05-05', 'present', '09:01:00', '18:10:00');
INSERT INTO public.attendance VALUES (68, 3, '2026-05-06', 'present', '09:07:00', '18:12:00');
INSERT INTO public.attendance VALUES (69, 3, '2026-05-07', 'present', '09:13:00', '18:13:00');
INSERT INTO public.attendance VALUES (70, 3, '2026-05-08', 'present', '09:12:00', '18:03:00');
INSERT INTO public.attendance VALUES (78, 3, '2026-05-16', 'present', '09:13:00', '18:09:00');
INSERT INTO public.attendance VALUES (80, 3, '2026-05-18', 'present', '09:00:00', '18:24:00');
INSERT INTO public.attendance VALUES (81, 3, '2026-05-19', 'present', '09:11:00', '18:04:00');
INSERT INTO public.attendance VALUES (82, 3, '2026-05-20', 'present', '09:02:00', '18:14:00');
INSERT INTO public.attendance VALUES (83, 3, '2026-05-21', 'present', '09:14:00', '18:01:00');
INSERT INTO public.attendance VALUES (84, 3, '2026-05-22', 'present', '09:14:00', '18:03:00');
INSERT INTO public.attendance VALUES (89, 3, '2026-05-27', 'present', '09:54:00', '18:58:00');
INSERT INTO public.attendance VALUES (91, 3, '2026-05-29', 'present', '09:44:00', '18:41:00');
INSERT INTO public.attendance VALUES (95, 4, '2026-05-02', 'present', '09:35:00', '18:40:00');
INSERT INTO public.attendance VALUES (97, 4, '2026-05-04', 'present', '09:10:00', '18:20:00');
INSERT INTO public.attendance VALUES (98, 4, '2026-05-05', 'present', '09:05:00', '13:02:00');
INSERT INTO public.attendance VALUES (99, 4, '2026-05-06', 'present', '09:13:00', '18:23:00');
INSERT INTO public.attendance VALUES (100, 4, '2026-05-07', 'present', '09:07:00', '18:15:00');
INSERT INTO public.attendance VALUES (101, 4, '2026-05-08', 'present', '09:04:00', '18:16:00');
INSERT INTO public.attendance VALUES (109, 4, '2026-05-16', 'present', '09:04:00', '18:10:00');
INSERT INTO public.attendance VALUES (111, 4, '2026-05-18', 'present', '09:05:00', '18:01:00');
INSERT INTO public.attendance VALUES (112, 4, '2026-05-19', 'present', '09:12:00', '18:05:00');
INSERT INTO public.attendance VALUES (113, 4, '2026-05-20', 'present', '09:12:00', '18:06:00');
INSERT INTO public.attendance VALUES (114, 4, '2026-05-21', 'present', '09:08:00', '18:20:00');
INSERT INTO public.attendance VALUES (116, 4, '2026-05-23', 'present', '09:02:00', '18:21:00');
INSERT INTO public.attendance VALUES (118, 4, '2026-05-25', 'present', '09:02:00', '13:12:00');
INSERT INTO public.attendance VALUES (120, 4, '2026-05-27', 'present', '09:11:00', '18:15:00');
INSERT INTO public.attendance VALUES (121, 4, '2026-05-28', 'present', '09:13:00', '18:13:00');
INSERT INTO public.attendance VALUES (122, 4, '2026-05-29', 'present', '09:58:00', '18:31:00');
INSERT INTO public.attendance VALUES (123, 4, '2026-05-30', 'present', '09:04:00', '18:15:00');
INSERT INTO public.attendance VALUES (126, 5, '2026-05-02', 'present', '09:09:00', '13:05:00');
INSERT INTO public.attendance VALUES (128, 5, '2026-05-04', 'present', '09:04:00', '18:23:00');
INSERT INTO public.attendance VALUES (129, 5, '2026-05-05', 'present', '09:08:00', '13:13:00');
INSERT INTO public.attendance VALUES (130, 5, '2026-05-06', 'present', '09:06:00', '13:10:00');
INSERT INTO public.attendance VALUES (131, 5, '2026-05-07', 'present', '09:04:00', '18:27:00');
INSERT INTO public.attendance VALUES (132, 5, '2026-05-08', 'present', '09:03:00', '13:03:00');
INSERT INTO public.attendance VALUES (140, 5, '2026-05-16', 'present', '09:54:00', '18:53:00');
INSERT INTO public.attendance VALUES (142, 5, '2026-05-18', 'present', '09:08:00', '18:11:00');
INSERT INTO public.attendance VALUES (143, 5, '2026-05-19', 'present', '09:09:00', '18:11:00');
INSERT INTO public.attendance VALUES (144, 5, '2026-05-20', 'present', '09:06:00', '18:12:00');
INSERT INTO public.attendance VALUES (145, 5, '2026-05-21', 'present', '09:04:00', '18:17:00');
INSERT INTO public.attendance VALUES (146, 5, '2026-05-22', 'present', '09:09:00', '18:19:00');
INSERT INTO public.attendance VALUES (147, 5, '2026-05-23', 'present', '09:09:00', '18:19:00');
INSERT INTO public.attendance VALUES (149, 5, '2026-05-25', 'present', '09:13:00', '13:04:00');
INSERT INTO public.attendance VALUES (151, 5, '2026-05-27', 'present', '09:13:00', '18:16:00');
INSERT INTO public.attendance VALUES (154, 5, '2026-05-30', 'present', '09:03:00', '18:22:00');
INSERT INTO public.attendance VALUES (159, 6, '2026-05-04', 'present', '09:08:00', '18:19:00');
INSERT INTO public.attendance VALUES (160, 6, '2026-05-05', 'present', '09:51:00', '18:47:00');
INSERT INTO public.attendance VALUES (161, 6, '2026-05-06', 'present', '09:12:00', '18:27:00');
INSERT INTO public.attendance VALUES (162, 6, '2026-05-07', 'present', '09:10:00', '18:11:00');
INSERT INTO public.attendance VALUES (163, 6, '2026-05-08', 'present', '09:05:00', '18:07:00');
INSERT INTO public.attendance VALUES (171, 6, '2026-05-16', 'present', '09:05:00', '18:24:00');
INSERT INTO public.attendance VALUES (173, 6, '2026-05-18', 'present', '09:08:00', '18:23:00');
INSERT INTO public.attendance VALUES (174, 6, '2026-05-19', 'present', '09:01:00', '18:20:00');
INSERT INTO public.attendance VALUES (175, 6, '2026-05-20', 'present', '09:08:00', '18:22:00');
INSERT INTO public.attendance VALUES (176, 6, '2026-05-21', 'present', '09:06:00', '18:20:00');
INSERT INTO public.attendance VALUES (178, 6, '2026-05-23', 'present', '09:09:00', '18:07:00');
INSERT INTO public.attendance VALUES (180, 6, '2026-05-25', 'present', '09:06:00', '13:14:00');
INSERT INTO public.attendance VALUES (183, 6, '2026-05-28', 'present', '09:11:00', '18:24:00');
INSERT INTO public.attendance VALUES (184, 6, '2026-05-29', 'present', '09:13:00', '18:05:00');
INSERT INTO public.attendance VALUES (185, 6, '2026-05-30', 'present', '09:03:00', '18:00:00');
INSERT INTO public.attendance VALUES (188, 7, '2026-05-02', 'present', '09:14:00', '18:12:00');
INSERT INTO public.attendance VALUES (190, 7, '2026-05-04', 'present', '09:45:00', '18:37:00');
INSERT INTO public.attendance VALUES (193, 7, '2026-05-07', 'present', '09:07:00', '18:21:00');
INSERT INTO public.attendance VALUES (194, 7, '2026-05-08', 'present', '09:08:00', '18:25:00');
INSERT INTO public.attendance VALUES (202, 7, '2026-05-16', 'present', '09:02:00', '18:24:00');
INSERT INTO public.attendance VALUES (204, 7, '2026-05-18', 'present', '09:02:00', '18:02:00');
INSERT INTO public.attendance VALUES (205, 7, '2026-05-19', 'present', '09:01:00', '18:01:00');
INSERT INTO public.attendance VALUES (207, 7, '2026-05-21', 'present', '09:13:00', '18:22:00');
INSERT INTO public.attendance VALUES (208, 7, '2026-05-22', 'present', '09:00:00', '18:25:00');
INSERT INTO public.attendance VALUES (209, 7, '2026-05-23', 'present', '09:14:00', '18:21:00');
INSERT INTO public.attendance VALUES (211, 7, '2026-05-25', 'present', '09:08:00', '18:05:00');
INSERT INTO public.attendance VALUES (213, 7, '2026-05-27', 'present', '09:11:00', '18:01:00');
INSERT INTO public.attendance VALUES (214, 7, '2026-05-28', 'present', '09:00:00', '18:10:00');
INSERT INTO public.attendance VALUES (215, 7, '2026-05-29', 'present', '09:06:00', '18:09:00');
INSERT INTO public.attendance VALUES (216, 7, '2026-05-30', 'present', '09:03:00', '13:01:00');
INSERT INTO public.attendance VALUES (219, 8, '2026-05-02', 'present', '09:12:00', '13:11:00');
INSERT INTO public.attendance VALUES (221, 8, '2026-05-04', 'present', '09:06:00', '18:10:00');
INSERT INTO public.attendance VALUES (222, 8, '2026-05-05', 'present', '09:09:00', '18:28:00');
INSERT INTO public.attendance VALUES (223, 8, '2026-05-06', 'present', '09:31:00', '18:52:00');
INSERT INTO public.attendance VALUES (224, 8, '2026-05-07', 'present', '09:09:00', '18:24:00');
INSERT INTO public.attendance VALUES (225, 8, '2026-05-08', 'present', '09:07:00', '18:28:00');
INSERT INTO public.attendance VALUES (233, 8, '2026-05-16', 'present', '09:05:00', '18:24:00');
INSERT INTO public.attendance VALUES (235, 8, '2026-05-18', 'present', '09:48:00', '18:32:00');
INSERT INTO public.attendance VALUES (236, 8, '2026-05-19', 'present', '09:00:00', '13:12:00');
INSERT INTO public.attendance VALUES (238, 8, '2026-05-21', 'present', '09:12:00', '18:04:00');
INSERT INTO public.attendance VALUES (239, 8, '2026-05-22', 'present', '09:01:00', '18:08:00');
INSERT INTO public.attendance VALUES (240, 8, '2026-05-23', 'present', '09:06:00', '18:02:00');
INSERT INTO public.attendance VALUES (244, 8, '2026-05-27', 'present', '09:09:00', '18:08:00');
INSERT INTO public.attendance VALUES (245, 8, '2026-05-28', 'present', '09:04:00', '18:00:00');
INSERT INTO public.attendance VALUES (246, 8, '2026-05-29', 'present', '09:34:00', '18:35:00');
INSERT INTO public.attendance VALUES (247, 8, '2026-05-30', 'present', '09:47:00', '18:34:00');
INSERT INTO public.attendance VALUES (250, 9, '2026-05-02', 'present', '09:12:00', '18:01:00');
INSERT INTO public.attendance VALUES (252, 9, '2026-05-04', 'present', '09:14:00', '18:09:00');
INSERT INTO public.attendance VALUES (254, 9, '2026-05-06', 'present', '09:07:00', '18:06:00');
INSERT INTO public.attendance VALUES (255, 9, '2026-05-07', 'present', '09:10:00', '13:04:00');
INSERT INTO public.attendance VALUES (256, 9, '2026-05-08', 'present', '09:06:00', '18:06:00');
INSERT INTO public.attendance VALUES (264, 9, '2026-05-16', 'present', '09:14:00', '13:07:00');
INSERT INTO public.attendance VALUES (266, 9, '2026-05-18', 'present', '09:10:00', '18:25:00');
INSERT INTO public.attendance VALUES (267, 9, '2026-05-19', 'present', '09:07:00', '18:17:00');
INSERT INTO public.attendance VALUES (268, 9, '2026-05-20', 'present', '09:11:00', '18:04:00');
INSERT INTO public.attendance VALUES (269, 9, '2026-05-21', 'present', '09:09:00', '18:05:00');
INSERT INTO public.attendance VALUES (270, 9, '2026-05-22', 'present', '09:07:00', '18:17:00');
INSERT INTO public.attendance VALUES (273, 9, '2026-05-25', 'present', '09:02:00', '18:07:00');
INSERT INTO public.attendance VALUES (275, 9, '2026-05-27', 'present', '09:06:00', '18:13:00');
INSERT INTO public.attendance VALUES (277, 9, '2026-05-29', 'present', '09:39:00', '18:40:00');
INSERT INTO public.attendance VALUES (278, 9, '2026-05-30', 'present', '09:10:00', '13:01:00');
INSERT INTO public.attendance VALUES (284, 10, '2026-05-05', 'present', '09:03:00', '13:12:00');
INSERT INTO public.attendance VALUES (285, 10, '2026-05-06', 'present', '09:00:00', '18:11:00');
INSERT INTO public.attendance VALUES (286, 10, '2026-05-07', 'present', '09:01:00', '13:08:00');
INSERT INTO public.attendance VALUES (287, 10, '2026-05-08', 'present', '09:01:00', '18:06:00');
INSERT INTO public.attendance VALUES (295, 10, '2026-05-16', 'present', '09:14:00', '18:24:00');
INSERT INTO public.attendance VALUES (297, 10, '2026-05-18', 'present', '09:47:00', '18:43:00');
INSERT INTO public.attendance VALUES (298, 10, '2026-05-19', 'present', '09:44:00', '18:35:00');
INSERT INTO public.attendance VALUES (299, 10, '2026-05-20', 'present', '09:04:00', '13:11:00');
INSERT INTO public.attendance VALUES (300, 10, '2026-05-21', 'present', '09:13:00', '18:21:00');
INSERT INTO public.attendance VALUES (301, 10, '2026-05-22', 'present', '09:12:00', '13:08:00');
INSERT INTO public.attendance VALUES (302, 10, '2026-05-23', 'present', '09:12:00', '18:21:00');
INSERT INTO public.attendance VALUES (304, 10, '2026-05-25', 'present', '09:12:00', '18:29:00');
INSERT INTO public.attendance VALUES (306, 10, '2026-05-27', 'present', '09:07:00', '18:01:00');
INSERT INTO public.attendance VALUES (307, 10, '2026-05-28', 'present', '09:06:00', '18:26:00');
INSERT INTO public.attendance VALUES (308, 10, '2026-05-29', 'present', '09:12:00', '18:27:00');
INSERT INTO public.attendance VALUES (309, 10, '2026-05-30', 'present', '09:03:00', '18:27:00');
INSERT INTO public.attendance VALUES (312, 11, '2026-05-02', 'present', '09:13:00', '18:12:00');
INSERT INTO public.attendance VALUES (314, 11, '2026-05-04', 'present', '09:14:00', '18:23:00');
INSERT INTO public.attendance VALUES (315, 11, '2026-05-05', 'present', '09:09:00', '18:01:00');
INSERT INTO public.attendance VALUES (316, 11, '2026-05-06', 'present', '09:11:00', '18:09:00');
INSERT INTO public.attendance VALUES (317, 11, '2026-05-07', 'present', '09:43:00', '18:58:00');
INSERT INTO public.attendance VALUES (318, 11, '2026-05-08', 'present', '09:10:00', '18:01:00');
INSERT INTO public.attendance VALUES (326, 11, '2026-05-16', 'present', '09:10:00', '13:03:00');
INSERT INTO public.attendance VALUES (328, 11, '2026-05-18', 'present', '09:05:00', '13:07:00');
INSERT INTO public.attendance VALUES (329, 11, '2026-05-19', 'present', '09:05:00', '18:22:00');
INSERT INTO public.attendance VALUES (330, 11, '2026-05-20', 'present', '09:51:00', '18:32:00');
INSERT INTO public.attendance VALUES (331, 11, '2026-05-21', 'present', '09:04:00', '18:15:00');
INSERT INTO public.attendance VALUES (332, 11, '2026-05-22', 'present', '09:09:00', '18:27:00');
INSERT INTO public.attendance VALUES (333, 11, '2026-05-23', 'present', '09:12:00', '18:29:00');
INSERT INTO public.attendance VALUES (335, 11, '2026-05-25', 'present', '09:13:00', '18:00:00');
INSERT INTO public.attendance VALUES (338, 11, '2026-05-28', 'present', '09:14:00', '18:20:00');
INSERT INTO public.attendance VALUES (339, 11, '2026-05-29', 'present', '09:52:00', '18:55:00');
INSERT INTO public.attendance VALUES (340, 11, '2026-05-30', 'present', '09:54:00', '18:32:00');
INSERT INTO public.attendance VALUES (343, 12, '2026-05-02', 'present', '09:00:00', '18:17:00');
INSERT INTO public.attendance VALUES (347, 12, '2026-05-06', 'present', '09:05:00', '18:04:00');
INSERT INTO public.attendance VALUES (348, 12, '2026-05-07', 'present', '09:10:00', '18:27:00');
INSERT INTO public.attendance VALUES (349, 12, '2026-05-08', 'present', '09:12:00', '18:23:00');
INSERT INTO public.attendance VALUES (357, 12, '2026-05-16', 'present', '09:10:00', '18:27:00');
INSERT INTO public.attendance VALUES (359, 12, '2026-05-18', 'present', '09:09:00', '18:27:00');
INSERT INTO public.attendance VALUES (361, 12, '2026-05-20', 'present', '09:05:00', '18:27:00');
INSERT INTO public.attendance VALUES (362, 12, '2026-05-21', 'present', '09:00:00', '18:05:00');
INSERT INTO public.attendance VALUES (363, 12, '2026-05-22', 'present', '09:10:00', '18:04:00');
INSERT INTO public.attendance VALUES (364, 12, '2026-05-23', 'present', '09:06:00', '18:05:00');
INSERT INTO public.attendance VALUES (366, 12, '2026-05-25', 'present', '09:13:00', '13:01:00');
INSERT INTO public.attendance VALUES (368, 12, '2026-05-27', 'present', '09:32:00', '18:51:00');
INSERT INTO public.attendance VALUES (369, 12, '2026-05-28', 'present', '09:00:00', '13:09:00');
INSERT INTO public.attendance VALUES (370, 12, '2026-05-29', 'present', '09:01:00', '18:11:00');
INSERT INTO public.attendance VALUES (371, 12, '2026-05-30', 'present', '09:06:00', '18:26:00');
INSERT INTO public.attendance VALUES (376, 13, '2026-05-04', 'present', '09:11:00', '18:05:00');
INSERT INTO public.attendance VALUES (378, 13, '2026-05-06', 'present', '09:14:00', '18:20:00');
INSERT INTO public.attendance VALUES (379, 13, '2026-05-07', 'present', '09:54:00', '18:54:00');
INSERT INTO public.attendance VALUES (380, 13, '2026-05-08', 'present', '09:00:00', '18:19:00');
INSERT INTO public.attendance VALUES (388, 13, '2026-05-16', 'present', '09:01:00', '18:06:00');
INSERT INTO public.attendance VALUES (390, 13, '2026-05-18', 'present', '09:01:00', '18:21:00');
INSERT INTO public.attendance VALUES (391, 13, '2026-05-19', 'present', '09:09:00', '18:11:00');
INSERT INTO public.attendance VALUES (392, 13, '2026-05-20', 'present', '09:53:00', '18:55:00');
INSERT INTO public.attendance VALUES (393, 13, '2026-05-21', 'present', '09:11:00', '18:20:00');
INSERT INTO public.attendance VALUES (394, 13, '2026-05-22', 'present', '09:01:00', '18:17:00');
INSERT INTO public.attendance VALUES (397, 13, '2026-05-25', 'present', '09:11:00', '18:12:00');
INSERT INTO public.attendance VALUES (399, 13, '2026-05-27', 'present', '09:04:00', '18:06:00');
INSERT INTO public.attendance VALUES (400, 13, '2026-05-28', 'present', '09:01:00', '18:00:00');
INSERT INTO public.attendance VALUES (401, 13, '2026-05-29', 'present', '09:00:00', '18:03:00');
INSERT INTO public.attendance VALUES (402, 13, '2026-05-30', 'present', '09:02:00', '18:24:00');
INSERT INTO public.attendance VALUES (405, 14, '2026-05-02', 'present', '09:02:00', '18:14:00');
INSERT INTO public.attendance VALUES (408, 14, '2026-05-05', 'present', '09:02:00', '18:16:00');
INSERT INTO public.attendance VALUES (409, 14, '2026-05-06', 'present', '09:11:00', '18:14:00');
INSERT INTO public.attendance VALUES (410, 14, '2026-05-07', 'present', '09:12:00', '18:17:00');
INSERT INTO public.attendance VALUES (419, 14, '2026-05-16', 'present', '09:05:00', '18:14:00');
INSERT INTO public.attendance VALUES (421, 14, '2026-05-18', 'present', '09:07:00', '18:29:00');
INSERT INTO public.attendance VALUES (422, 14, '2026-05-19', 'present', '09:09:00', '18:11:00');
INSERT INTO public.attendance VALUES (424, 14, '2026-05-21', 'present', '09:04:00', '18:10:00');
INSERT INTO public.attendance VALUES (425, 14, '2026-05-22', 'present', '09:11:00', '18:16:00');
INSERT INTO public.attendance VALUES (426, 14, '2026-05-23', 'present', '09:05:00', '18:06:00');
INSERT INTO public.attendance VALUES (428, 14, '2026-05-25', 'present', '09:06:00', '13:02:00');
INSERT INTO public.attendance VALUES (430, 14, '2026-05-27', 'present', '09:11:00', '18:21:00');
INSERT INTO public.attendance VALUES (431, 14, '2026-05-28', 'present', '09:13:00', '18:17:00');
INSERT INTO public.attendance VALUES (432, 14, '2026-05-29', 'present', '09:13:00', '18:15:00');
INSERT INTO public.attendance VALUES (433, 14, '2026-05-30', 'present', '09:12:00', '18:08:00');
INSERT INTO public.attendance VALUES (436, 15, '2026-05-02', 'present', '09:00:00', '18:03:00');
INSERT INTO public.attendance VALUES (438, 15, '2026-05-04', 'present', '09:08:00', '18:15:00');
INSERT INTO public.attendance VALUES (439, 15, '2026-05-05', 'present', '09:10:00', '18:16:00');
INSERT INTO public.attendance VALUES (440, 15, '2026-05-06', 'present', '09:10:00', '18:02:00');
INSERT INTO public.attendance VALUES (441, 15, '2026-05-07', 'present', '09:13:00', '18:25:00');
INSERT INTO public.attendance VALUES (442, 15, '2026-05-08', 'present', '09:09:00', '18:11:00');
INSERT INTO public.attendance VALUES (450, 15, '2026-05-16', 'present', '09:05:00', '18:28:00');
INSERT INTO public.attendance VALUES (452, 15, '2026-05-18', 'present', '09:02:00', '18:26:00');
INSERT INTO public.attendance VALUES (453, 15, '2026-05-19', 'present', '09:05:00', '18:21:00');
INSERT INTO public.attendance VALUES (454, 15, '2026-05-20', 'present', '09:13:00', '18:12:00');
INSERT INTO public.attendance VALUES (455, 15, '2026-05-21', 'present', '09:03:00', '18:02:00');
INSERT INTO public.attendance VALUES (456, 15, '2026-05-22', 'present', '09:03:00', '18:17:00');
INSERT INTO public.attendance VALUES (457, 15, '2026-05-23', 'present', '09:01:00', '18:03:00');
INSERT INTO public.attendance VALUES (459, 15, '2026-05-25', 'present', '09:07:00', '18:08:00');
INSERT INTO public.attendance VALUES (461, 15, '2026-05-27', 'present', '09:37:00', '18:55:00');
INSERT INTO public.attendance VALUES (462, 15, '2026-05-28', 'present', '09:07:00', '18:28:00');
INSERT INTO public.attendance VALUES (463, 15, '2026-05-29', 'present', '09:05:00', '18:24:00');
INSERT INTO public.attendance VALUES (464, 15, '2026-05-30', 'present', '09:11:00', '18:24:00');
INSERT INTO public.attendance VALUES (467, 16, '2026-05-02', 'present', '09:06:00', '18:27:00');
INSERT INTO public.attendance VALUES (469, 16, '2026-05-04', 'present', '09:02:00', '18:19:00');
INSERT INTO public.attendance VALUES (470, 16, '2026-05-05', 'present', '09:00:00', '18:19:00');
INSERT INTO public.attendance VALUES (471, 16, '2026-05-06', 'present', '09:12:00', '18:22:00');
INSERT INTO public.attendance VALUES (472, 16, '2026-05-07', 'present', '09:00:00', '18:20:00');
INSERT INTO public.attendance VALUES (481, 16, '2026-05-16', 'present', '09:05:00', '18:13:00');
INSERT INTO public.attendance VALUES (483, 16, '2026-05-18', 'present', '09:30:00', '18:59:00');
INSERT INTO public.attendance VALUES (484, 16, '2026-05-19', 'present', '09:06:00', '18:23:00');
INSERT INTO public.attendance VALUES (485, 16, '2026-05-20', 'present', '09:02:00', '18:23:00');
INSERT INTO public.attendance VALUES (487, 16, '2026-05-22', 'present', '09:01:00', '13:10:00');
INSERT INTO public.attendance VALUES (488, 16, '2026-05-23', 'present', '09:14:00', '18:00:00');
INSERT INTO public.attendance VALUES (490, 16, '2026-05-25', 'present', '09:05:00', '18:08:00');
INSERT INTO public.attendance VALUES (492, 16, '2026-05-27', 'present', '09:09:00', '18:09:00');
INSERT INTO public.attendance VALUES (493, 16, '2026-05-28', 'present', '09:01:00', '18:04:00');
INSERT INTO public.attendance VALUES (494, 16, '2026-05-29', 'present', '09:04:00', '18:25:00');
INSERT INTO public.attendance VALUES (500, 17, '2026-05-04', 'present', '09:07:00', '18:00:00');
INSERT INTO public.attendance VALUES (501, 17, '2026-05-05', 'present', '09:06:00', '18:20:00');
INSERT INTO public.attendance VALUES (502, 17, '2026-05-06', 'present', '09:12:00', '18:19:00');
INSERT INTO public.attendance VALUES (503, 17, '2026-05-07', 'present', '09:04:00', '18:15:00');
INSERT INTO public.attendance VALUES (512, 17, '2026-05-16', 'present', '09:13:00', '18:23:00');
INSERT INTO public.attendance VALUES (514, 17, '2026-05-18', 'present', '09:14:00', '18:06:00');
INSERT INTO public.attendance VALUES (515, 17, '2026-05-19', 'present', '09:14:00', '18:20:00');
INSERT INTO public.attendance VALUES (516, 17, '2026-05-20', 'present', '09:11:00', '13:11:00');
INSERT INTO public.attendance VALUES (517, 17, '2026-05-21', 'present', '09:49:00', '18:51:00');
INSERT INTO public.attendance VALUES (518, 17, '2026-05-22', 'present', '09:07:00', '18:02:00');
INSERT INTO public.attendance VALUES (519, 17, '2026-05-23', 'present', '09:08:00', '18:07:00');
INSERT INTO public.attendance VALUES (521, 17, '2026-05-25', 'present', '09:11:00', '13:03:00');
INSERT INTO public.attendance VALUES (523, 17, '2026-05-27', 'present', '09:01:00', '18:28:00');
INSERT INTO public.attendance VALUES (524, 17, '2026-05-28', 'present', '09:12:00', '18:00:00');
INSERT INTO public.attendance VALUES (526, 17, '2026-05-30', 'present', '09:02:00', '18:25:00');
INSERT INTO public.attendance VALUES (529, 18, '2026-05-02', 'present', '09:05:00', '18:10:00');
INSERT INTO public.attendance VALUES (531, 18, '2026-05-04', 'present', '09:09:00', '18:14:00');
INSERT INTO public.attendance VALUES (532, 18, '2026-05-05', 'present', '09:06:00', '18:17:00');
INSERT INTO public.attendance VALUES (533, 18, '2026-05-06', 'present', '09:14:00', '18:15:00');
INSERT INTO public.attendance VALUES (535, 18, '2026-05-08', 'present', '09:04:00', '18:21:00');
INSERT INTO public.attendance VALUES (543, 18, '2026-05-16', 'present', '09:14:00', '18:09:00');
INSERT INTO public.attendance VALUES (546, 18, '2026-05-19', 'present', '09:03:00', '18:17:00');
INSERT INTO public.attendance VALUES (547, 18, '2026-05-20', 'present', '09:08:00', '18:08:00');
INSERT INTO public.attendance VALUES (549, 18, '2026-05-22', 'present', '09:48:00', '18:48:00');
INSERT INTO public.attendance VALUES (550, 18, '2026-05-23', 'present', '09:12:00', '13:12:00');
INSERT INTO public.attendance VALUES (552, 18, '2026-05-25', 'present', '09:01:00', '18:24:00');
INSERT INTO public.attendance VALUES (554, 18, '2026-05-27', 'present', '09:13:00', '18:09:00');
INSERT INTO public.attendance VALUES (555, 18, '2026-05-28', 'present', '09:01:00', '18:14:00');
INSERT INTO public.attendance VALUES (556, 18, '2026-05-29', 'present', '09:06:00', '18:18:00');
INSERT INTO public.attendance VALUES (560, 19, '2026-05-02', 'present', '09:13:00', '18:29:00');
INSERT INTO public.attendance VALUES (562, 19, '2026-05-04', 'present', '09:06:00', '18:28:00');
INSERT INTO public.attendance VALUES (563, 19, '2026-05-05', 'present', '09:03:00', '18:19:00');
INSERT INTO public.attendance VALUES (564, 19, '2026-05-06', 'present', '09:11:00', '18:01:00');
INSERT INTO public.attendance VALUES (565, 19, '2026-05-07', 'present', '09:12:00', '18:03:00');
INSERT INTO public.attendance VALUES (566, 19, '2026-05-08', 'present', '09:04:00', '18:07:00');
INSERT INTO public.attendance VALUES (574, 19, '2026-05-16', 'present', '09:35:00', '18:51:00');
INSERT INTO public.attendance VALUES (577, 19, '2026-05-19', 'present', '09:14:00', '18:13:00');
INSERT INTO public.attendance VALUES (578, 19, '2026-05-20', 'present', '09:07:00', '13:03:00');
INSERT INTO public.attendance VALUES (581, 19, '2026-05-23', 'present', '09:05:00', '18:12:00');
INSERT INTO public.attendance VALUES (583, 19, '2026-05-25', 'present', '09:09:00', '18:15:00');
INSERT INTO public.attendance VALUES (585, 19, '2026-05-27', 'present', '09:00:00', '18:21:00');
INSERT INTO public.attendance VALUES (586, 19, '2026-05-28', 'present', '09:48:00', '18:52:00');
INSERT INTO public.attendance VALUES (587, 19, '2026-05-29', 'present', '09:10:00', '18:26:00');
INSERT INTO public.attendance VALUES (591, 20, '2026-05-02', 'present', '09:13:00', '18:20:00');
INSERT INTO public.attendance VALUES (593, 20, '2026-05-04', 'present', '09:00:00', '18:18:00');
INSERT INTO public.attendance VALUES (594, 20, '2026-05-05', 'present', '09:06:00', '18:10:00');
INSERT INTO public.attendance VALUES (596, 20, '2026-05-07', 'present', '09:47:00', '18:38:00');
INSERT INTO public.attendance VALUES (597, 20, '2026-05-08', 'present', '09:06:00', '18:25:00');
INSERT INTO public.attendance VALUES (605, 20, '2026-05-16', 'present', '09:54:00', '18:57:00');
INSERT INTO public.attendance VALUES (607, 20, '2026-05-18', 'present', '09:12:00', '18:19:00');
INSERT INTO public.attendance VALUES (608, 20, '2026-05-19', 'present', '09:13:00', '18:02:00');
INSERT INTO public.attendance VALUES (609, 20, '2026-05-20', 'present', '09:01:00', '18:27:00');
INSERT INTO public.attendance VALUES (610, 20, '2026-05-21', 'present', '09:11:00', '18:14:00');
INSERT INTO public.attendance VALUES (611, 20, '2026-05-22', 'present', '09:03:00', '18:15:00');
INSERT INTO public.attendance VALUES (612, 20, '2026-05-23', 'present', '09:10:00', '18:01:00');
INSERT INTO public.attendance VALUES (616, 20, '2026-05-27', 'present', '09:13:00', '18:20:00');
INSERT INTO public.attendance VALUES (617, 20, '2026-05-28', 'present', '09:03:00', '18:07:00');
INSERT INTO public.attendance VALUES (618, 20, '2026-05-29', 'present', '09:08:00', '18:17:00');
INSERT INTO public.attendance VALUES (619, 20, '2026-05-30', 'present', '09:10:00', '13:12:00');
INSERT INTO public.attendance VALUES (622, 21, '2026-05-02', 'present', '09:09:00', '18:13:00');
INSERT INTO public.attendance VALUES (624, 21, '2026-05-04', 'present', '09:00:00', '18:16:00');
INSERT INTO public.attendance VALUES (625, 21, '2026-05-05', 'present', '09:05:00', '18:24:00');
INSERT INTO public.attendance VALUES (626, 21, '2026-05-06', 'present', '09:38:00', '18:57:00');
INSERT INTO public.attendance VALUES (627, 21, '2026-05-07', 'present', '09:08:00', '18:12:00');
INSERT INTO public.attendance VALUES (628, 21, '2026-05-08', 'present', '09:00:00', '18:24:00');
INSERT INTO public.attendance VALUES (636, 21, '2026-05-16', 'present', '09:08:00', '18:13:00');
INSERT INTO public.attendance VALUES (638, 21, '2026-05-18', 'present', '09:03:00', '18:20:00');
INSERT INTO public.attendance VALUES (639, 21, '2026-05-19', 'present', '09:02:00', '18:21:00');
INSERT INTO public.attendance VALUES (641, 21, '2026-05-21', 'present', '09:14:00', '18:25:00');
INSERT INTO public.attendance VALUES (642, 21, '2026-05-22', 'present', '09:00:00', '18:28:00');
INSERT INTO public.attendance VALUES (643, 21, '2026-05-23', 'present', '09:09:00', '18:04:00');
INSERT INTO public.attendance VALUES (645, 21, '2026-05-25', 'present', '09:13:00', '18:11:00');
INSERT INTO public.attendance VALUES (647, 21, '2026-05-27', 'present', '09:05:00', '18:00:00');
INSERT INTO public.attendance VALUES (648, 21, '2026-05-28', 'present', '09:07:00', '18:29:00');
INSERT INTO public.attendance VALUES (653, 22, '2026-05-02', 'present', '09:02:00', '13:07:00');
INSERT INTO public.attendance VALUES (655, 22, '2026-05-04', 'present', '09:04:00', '18:23:00');
INSERT INTO public.attendance VALUES (656, 22, '2026-05-05', 'present', '09:10:00', '18:15:00');
INSERT INTO public.attendance VALUES (657, 22, '2026-05-06', 'present', '09:12:00', '18:03:00');
INSERT INTO public.attendance VALUES (658, 22, '2026-05-07', 'present', '09:13:00', '18:28:00');
INSERT INTO public.attendance VALUES (659, 22, '2026-05-08', 'present', '09:10:00', '18:04:00');
INSERT INTO public.attendance VALUES (667, 22, '2026-05-16', 'present', '09:52:00', '18:55:00');
INSERT INTO public.attendance VALUES (669, 22, '2026-05-18', 'present', '09:38:00', '18:39:00');
INSERT INTO public.attendance VALUES (670, 22, '2026-05-19', 'present', '09:08:00', '18:00:00');
INSERT INTO public.attendance VALUES (671, 22, '2026-05-20', 'present', '09:06:00', '18:14:00');
INSERT INTO public.attendance VALUES (672, 22, '2026-05-21', 'present', '09:03:00', '18:01:00');
INSERT INTO public.attendance VALUES (673, 22, '2026-05-22', 'present', '09:10:00', '18:12:00');
INSERT INTO public.attendance VALUES (676, 22, '2026-05-25', 'present', '09:06:00', '18:10:00');
INSERT INTO public.attendance VALUES (678, 22, '2026-05-27', 'present', '09:04:00', '13:13:00');
INSERT INTO public.attendance VALUES (679, 22, '2026-05-28', 'present', '09:10:00', '18:06:00');
INSERT INTO public.attendance VALUES (680, 22, '2026-05-29', 'present', '09:02:00', '18:08:00');
INSERT INTO public.attendance VALUES (681, 22, '2026-05-30', 'present', '09:00:00', '18:26:00');
INSERT INTO public.attendance VALUES (683, 2, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (684, 3, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (685, 4, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (686, 5, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (688, 7, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (689, 8, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (690, 9, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (691, 10, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (692, 11, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (693, 12, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (695, 14, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (696, 15, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (697, 16, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (698, 17, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (699, 18, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (701, 20, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (703, 22, '2026-05-11', 'present', '09:55:00', '18:20:00');
INSERT INTO public.attendance VALUES (704, 2, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (705, 3, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (707, 5, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (708, 6, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (710, 8, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (711, 9, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (713, 11, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (715, 13, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (716, 14, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (717, 15, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (718, 16, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (719, 17, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (720, 18, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (722, 20, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (723, 21, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (724, 22, '2026-05-12', 'present', '09:58:00', '18:25:00');
INSERT INTO public.attendance VALUES (725, 2, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (726, 3, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (728, 5, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (729, 6, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (730, 7, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (731, 8, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (732, 9, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (733, 10, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (734, 11, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (735, 12, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (736, 13, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (737, 14, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (738, 15, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (740, 17, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (741, 18, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (742, 19, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (743, 20, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (744, 21, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (745, 22, '2026-05-13', 'present', '09:53:00', '18:15:00');
INSERT INTO public.attendance VALUES (746, 2, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (747, 3, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (748, 4, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (749, 5, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (751, 7, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (752, 8, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (755, 11, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (756, 12, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (757, 13, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (758, 14, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (759, 15, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (760, 16, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (761, 17, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (762, 18, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (763, 19, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (764, 20, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (766, 22, '2026-05-14', 'present', '09:50:00', '18:10:00');
INSERT INTO public.attendance VALUES (767, 2, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (768, 3, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (772, 7, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (773, 8, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (774, 9, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (775, 10, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (776, 11, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (779, 14, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (780, 15, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (781, 16, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (783, 18, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (784, 19, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (785, 20, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (786, 21, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (787, 22, '2026-05-15', 'present', '09:56:00', '18:30:00');
INSERT INTO public.attendance VALUES (789, 3, '2026-05-17', 'present', '09:45:00', '18:33:00');
INSERT INTO public.attendance VALUES (790, 4, '2026-05-17', 'present', '09:54:00', '18:24:00');
INSERT INTO public.attendance VALUES (791, 5, '2026-05-17', 'present', '09:00:00', '13:00:00');
INSERT INTO public.attendance VALUES (792, 6, '2026-05-17', 'present', '09:54:00', '18:15:00');
INSERT INTO public.attendance VALUES (793, 7, '2026-05-17', 'present', '09:53:00', '18:17:00');
INSERT INTO public.attendance VALUES (795, 9, '2026-05-17', 'present', '09:59:00', '18:19:00');
INSERT INTO public.attendance VALUES (796, 10, '2026-05-17', 'present', '09:47:00', '18:23:00');
INSERT INTO public.attendance VALUES (797, 11, '2026-05-17', 'present', '09:46:00', '19:06:00');
INSERT INTO public.attendance VALUES (799, 13, '2026-05-17', 'present', '09:49:00', '18:29:00');
INSERT INTO public.attendance VALUES (800, 14, '2026-05-17', 'present', '09:51:00', '18:57:00');
INSERT INTO public.attendance VALUES (801, 15, '2026-05-17', 'present', '09:55:00', '18:23:00');
INSERT INTO public.attendance VALUES (804, 18, '2026-05-17', 'present', '09:56:00', '18:25:00');
INSERT INTO public.attendance VALUES (805, 19, '2026-05-17', 'present', '09:58:00', '18:23:00');
INSERT INTO public.attendance VALUES (807, 21, '2026-05-17', 'present', '09:56:00', '18:29:00');
INSERT INTO public.attendance VALUES (808, 22, '2026-05-17', 'present', '09:54:00', '18:15:00');
INSERT INTO public.attendance VALUES (1, 1, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (3, 1, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (9, 1, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (10, 1, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (16, 1, '2026-05-16', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (24, 1, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (26, 1, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (30, 1, '2026-05-30', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (31, 1, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (32, 2, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (34, 2, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (39, 2, '2026-05-08', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (40, 2, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (41, 2, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (55, 2, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (57, 2, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (58, 2, '2026-05-27', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (59, 2, '2026-05-28', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (62, 2, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (63, 3, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (65, 3, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (71, 3, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (72, 3, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (85, 3, '2026-05-23', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (86, 3, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (87, 3, '2026-05-25', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (88, 3, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (90, 3, '2026-05-28', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (92, 3, '2026-05-30', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (93, 3, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (94, 4, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (96, 4, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (102, 4, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (103, 4, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (115, 4, '2026-05-22', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (117, 4, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (119, 4, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (124, 4, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (125, 5, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (127, 5, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (133, 5, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (134, 5, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (148, 5, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (150, 5, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (152, 5, '2026-05-28', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (153, 5, '2026-05-29', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (155, 5, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (156, 6, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (157, 6, '2026-05-02', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (158, 6, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (164, 6, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (165, 6, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (177, 6, '2026-05-22', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (179, 6, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (181, 6, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (182, 6, '2026-05-27', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (186, 6, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (187, 7, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (189, 7, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (191, 7, '2026-05-05', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (192, 7, '2026-05-06', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (195, 7, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (196, 7, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (206, 7, '2026-05-20', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (210, 7, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (212, 7, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (217, 7, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (218, 8, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (220, 8, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (226, 8, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (227, 8, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (237, 8, '2026-05-20', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (241, 8, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (242, 8, '2026-05-25', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (243, 8, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (248, 8, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (249, 9, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (251, 9, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (253, 9, '2026-05-05', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (257, 9, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (258, 9, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (271, 9, '2026-05-23', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (272, 9, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (274, 9, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (276, 9, '2026-05-28', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (279, 9, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (280, 10, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (281, 10, '2026-05-02', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (282, 10, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (283, 10, '2026-05-04', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (288, 10, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (289, 10, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (303, 10, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (305, 10, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (310, 10, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (311, 11, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (313, 11, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (319, 11, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (320, 11, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (334, 11, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (336, 11, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (337, 11, '2026-05-27', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (341, 11, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (342, 12, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (344, 12, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (345, 12, '2026-05-04', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (346, 12, '2026-05-05', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (350, 12, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (351, 12, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (360, 12, '2026-05-19', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (365, 12, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (367, 12, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (372, 12, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (373, 13, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (374, 13, '2026-05-02', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (375, 13, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (377, 13, '2026-05-05', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (381, 13, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (382, 13, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (395, 13, '2026-05-23', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (396, 13, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (398, 13, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (403, 13, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (404, 14, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (406, 14, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (407, 14, '2026-05-04', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (411, 14, '2026-05-08', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (412, 14, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (413, 14, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (423, 14, '2026-05-20', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (427, 14, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (429, 14, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (434, 14, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (435, 15, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (437, 15, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (443, 15, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (444, 15, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (458, 15, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (460, 15, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (465, 15, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (466, 16, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (468, 16, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (473, 16, '2026-05-08', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (474, 16, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (475, 16, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (486, 16, '2026-05-21', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (489, 16, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (491, 16, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (495, 16, '2026-05-30', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (496, 16, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (497, 17, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (498, 17, '2026-05-02', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (499, 17, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (504, 17, '2026-05-08', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (505, 17, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (506, 17, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (520, 17, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (522, 17, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (525, 17, '2026-05-29', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (527, 17, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (528, 18, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (530, 18, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (534, 18, '2026-05-07', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (536, 18, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (537, 18, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (545, 18, '2026-05-18', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (548, 18, '2026-05-21', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (551, 18, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (553, 18, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (557, 18, '2026-05-30', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (558, 18, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (559, 19, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (561, 19, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (567, 19, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (568, 19, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (576, 19, '2026-05-18', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (579, 19, '2026-05-21', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (580, 19, '2026-05-22', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (582, 19, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (584, 19, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (588, 19, '2026-05-30', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (589, 19, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (590, 20, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (592, 20, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (595, 20, '2026-05-06', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (598, 20, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (599, 20, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (613, 20, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (614, 20, '2026-05-25', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (615, 20, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (620, 20, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (621, 21, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (623, 21, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (629, 21, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (630, 21, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (640, 21, '2026-05-20', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (644, 21, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (646, 21, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (649, 21, '2026-05-29', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (650, 21, '2026-05-30', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (651, 21, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (652, 22, '2026-05-01', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (654, 22, '2026-05-03', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (660, 22, '2026-05-09', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (661, 22, '2026-05-10', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (674, 22, '2026-05-23', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (675, 22, '2026-05-24', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (677, 22, '2026-05-26', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (682, 22, '2026-05-31', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (788, 2, '2026-05-17', 'absent', NULL, NULL);
INSERT INTO public.attendance VALUES (798, 12, '2026-05-17', 'absent', NULL, NULL);


--
-- Data for Name: attendance_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.attendance_history VALUES (1, NULL, '2026-06-16', 'vikram.gupta@vjc.com', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '[]', '[]', NULL, NULL, 'admin@hrms.com', '2026-06-16 10:39:47.967836', 'no laptop', '{"oldValues": {"status": null, "check_in_time": null, "check_out_time": null}, "requestedValues": {"date": "2026-06-16", "reason": "no laptop", "check_in_time": "10:00:00", "check_out_time": "18:00:00"}}');
INSERT INTO public.attendance_history VALUES (2, NULL, '2026-06-16', 'manager.hyd@hrms.com', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '[]', '[]', NULL, NULL, 'manager.hyd@hrms.com', '2026-06-16 10:53:31.221957', 'power cut', '{"oldValues": {"status": null, "check_in_time": null, "check_out_time": null}, "requestedValues": {"date": "2026-06-16", "reason": "power cut", "check_in_time": "09:00", "check_out_time": "18:00"}}');


--
-- Data for Name: attendance_history_backup_20260615; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: attendance_records; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.attendance_records VALUES (111, 3, '2026-06-04', '10:16:00', '19:00:00', 'half_day', 16, 8.73, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-03 17:33:01.023219', '2026-06-04 12:16:33.515429', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (62, 3, '2026-06-02', '09:00:00', '18:00:00', 'half_day', 0, 8.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-02 22:11:00.469545', '2026-06-02 22:14:13.235656', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (14, 3, '2026-05-30', '09:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-05-30 22:38:03.400004', '2026-05-30 22:38:26.524604', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (127, 24, '2026-03-03', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (128, 24, '2026-03-04', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (30, 2, '2026-05-31', '11:10:00', '06:30:00', 'absent', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-06-01 04:03:17.008769', '2026-06-01 04:18:29.301919', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (129, 24, '2026-03-05', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (130, 24, '2026-03-06', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (131, 24, '2026-03-07', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (84, 3, '2026-06-03', '14:30:00', '19:30:00', 'half_day', 270, 4.50, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Branch Manager', '2026-06-03 14:30:54.364659', '2026-06-03 14:46:24.591434', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (43, 2, '2026-06-01', '11:00:00', '18:00:00', 'half_day', 45, 7.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-06-01 04:11:53.908873', '2026-06-01 08:07:35.295933', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (132, 24, '2026-03-09', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (133, 24, '2026-03-10', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (134, 24, '2026-03-11', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (135, 24, '2026-03-12', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (136, 24, '2026-03-13', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (137, 24, '2026-03-14', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (57, 2, '2026-06-02', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-06-02 10:52:07.603821', '2026-06-02 22:17:14.628332', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (138, 24, '2026-03-16', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (139, 24, '2026-03-17', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (140, 24, '2026-03-18', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (141, 24, '2026-03-19', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (142, 24, '2026-03-20', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (117, 2, '2026-06-04', '11:52:00', '19:00:00', 'half_day', 112, 7.13, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-06-04 11:52:39.087492', '2026-06-04 15:04:10.690618', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (121, 24, '2026-06-04', '00:00:00', '00:00:00', 'absent', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:15:32.963892', '2026-06-04 16:54:18.336342', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (162, 24, '2026-04-21', '00:00:00', '00:00:00', 'full_day', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 18:01:45.76125', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (118, 24, '2026-03-02', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:11:13.393062', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (143, 24, '2026-03-21', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (144, 24, '2026-03-23', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (145, 24, '2026-03-24', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (146, 24, '2026-03-25', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (147, 24, '2026-04-01', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (148, 24, '2026-04-02', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (149, 24, '2026-04-03', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (150, 24, '2026-04-04', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (151, 24, '2026-04-06', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (152, 24, '2026-04-07', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (153, 24, '2026-04-08', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (154, 24, '2026-04-09', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (155, 24, '2026-04-10', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (156, 24, '2026-04-11', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (157, 24, '2026-04-13', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (158, 24, '2026-04-15', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (159, 24, '2026-04-16', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (160, 24, '2026-04-17', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (161, 24, '2026-04-20', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (163, 24, '2026-04-22', '00:00:00', '00:00:00', 'absent', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 14:02:45.500419', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (81, 2, '2026-06-03', '14:21:00', '19:00:00', 'half_day', 261, 4.65, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-06-03 14:21:36.486243', '2026-06-03 21:40:52.821811', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (89, 2, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi', NULL);
INSERT INTO public.attendance_records VALUES (90, 3, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Branch Manager', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi', NULL);
INSERT INTO public.attendance_records VALUES (164, 24, '2026-04-23', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (165, 24, '2026-04-24', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (166, 24, '2026-04-25', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (167, 24, '2026-04-27', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (168, 24, '2026-04-28', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (169, 24, '2026-05-02', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (170, 24, '2026-05-04', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (171, 24, '2026-05-05', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (172, 24, '2026-05-06', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (173, 24, '2026-05-07', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (174, 24, '2026-05-08', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (175, 24, '2026-05-09', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (176, 24, '2026-05-11', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (177, 24, '2026-05-12', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (178, 24, '2026-05-13', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (179, 24, '2026-05-14', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (180, 24, '2026-05-15', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (181, 24, '2026-05-16', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (182, 24, '2026-05-18', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (183, 24, '2026-05-19', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (184, 24, '2026-05-20', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (185, 24, '2026-05-21', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (186, 24, '2026-05-22', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (187, 24, '2026-05-23', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (188, 24, '2026-06-01', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (189, 24, '2026-06-02', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (190, 24, '2026-06-03', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (192, 24, '2026-06-05', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (193, 24, '2026-06-06', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (195, 24, '2026-06-09', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (196, 24, '2026-06-10', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (197, 24, '2026-06-11', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (198, 24, '2026-06-12', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (199, 24, '2026-06-13', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (200, 24, '2026-06-15', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (202, 24, '2026-06-17', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (203, 24, '2026-06-18', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (204, 24, '2026-06-19', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (205, 24, '2026-06-20', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (206, 24, '2026-06-22', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (207, 24, '2026-06-23', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (209, 24, '2026-06-25', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (210, 24, '2026-06-26', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (211, 24, '2026-06-27', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (212, 24, '2026-06-29', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (214, 24, '2026-03-26', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 13:22:01.1672', '2026-06-04 13:22:01.214903', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (215, 24, '2026-03-27', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 13:22:22.435054', '2026-06-04 13:22:22.449946', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (216, 24, '2026-03-28', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 13:22:55.999697', '2026-06-04 13:22:56.025688', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (217, 24, '2026-03-30', '10:00:00', '14:30:00', 'half_day', 0, 4.50, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 13:23:17.712808', '2026-06-04 13:23:17.788265', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (220, 24, '2026-05-28', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 14:08:43.982135', '2026-06-04 14:08:44.061087', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (194, 24, '2026-06-08', '10:00:00', '19:00:00', 'absent', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 17:02:20.712371', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (208, 24, '2026-06-24', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 18:01:28.253499', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (201, 24, '2026-06-16', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-16 10:28:31.076667', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (221, 24, '2026-05-27', '00:00:00', '00:00:00', 'absent', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 14:09:02.69236', '2026-06-04 14:41:43.666105', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (213, 24, '2026-06-30', '10:00:00', '19:00:00', 'half_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 16:44:16.804991', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (230, 24, '2026-06-07', NULL, NULL, 'absent', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 16:58:06.537748', '2026-06-04 17:03:59.414962', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (236, 24, '2026-04-30', NULL, NULL, 'full_day', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 18:02:05.926201', '2026-06-04 18:02:05.999096', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (237, 24, '2026-03-31', NULL, NULL, 'full_day', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 18:02:20.371235', '2026-06-04 18:02:20.44364', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (238, 24, '2026-05-01', NULL, NULL, 'full_day', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 18:02:40.584799', '2026-06-04 18:02:40.658368', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (239, 24, '2026-04-05', NULL, NULL, 'absent', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 18:04:12.622532', '2026-06-04 18:04:21.035873', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);
INSERT INTO public.attendance_records VALUES (242, 2, '2026-06-16', '09:00:00', '18:00:00', 'half_day', 0, 8.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-16 10:53:31.221957', '2026-06-16 10:53:31.231506', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL, NULL);


--
-- Data for Name: attendance_records_backup_20260615; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.attendance_records_backup_20260615 VALUES (59, 10, '2026-06-02', '10:52:00', '18:00:00', 'absent', 52, 3.32, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Accounts', '2026-06-02 10:52:38.837056', '2026-06-02 22:27:32.71678', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (78, 10, '2026-06-03', '13:50:00', '18:00:00', 'half_day', 230, 4.17, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Accounts', '2026-06-03 13:50:31.086993', '2026-06-03 13:58:22.863251', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (64, 8, '2026-06-02', '10:00:00', '18:00:00', 'half_day', 0, 8.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-02 22:12:33.616245', '2026-06-02 22:13:01.402992', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (6, 5, '2026-05-30', '10:30:00', '16:14:00', 'absent', 30, 5.55, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Reception', '2026-05-30 16:12:07.452725', '2026-05-30 21:27:17.192521', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (111, 3, '2026-06-04', '10:16:00', '19:00:00', 'half_day', 16, 8.73, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-03 17:33:01.023219', '2026-06-04 12:16:33.515429', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (62, 3, '2026-06-02', '09:00:00', '18:00:00', 'half_day', 0, 8.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-02 22:11:00.469545', '2026-06-02 22:14:13.235656', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (14, 3, '2026-05-30', '09:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-05-30 22:38:03.400004', '2026-05-30 22:38:26.524604', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (16, 18, '2026-05-30', '22:56:29', '22:56:35', 'full_day', 836, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Process Team', '2026-05-30 22:56:29.345569', '2026-05-30 22:56:35.261272', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (127, 24, '2026-03-03', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (17, 20, '2026-05-30', NULL, NULL, 'half_day', 0, 0.00, 0, '[]', '[]', NULL, NULL, 'Dress code violation', 'Bangalore', 'Sales Team', '2026-05-31 00:12:11.448773', '2026-05-31 00:12:13.139995', NULL, 0, true, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (128, 24, '2026-03-04', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (30, 2, '2026-05-31', '11:10:00', '06:30:00', 'absent', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-06-01 04:03:17.008769', '2026-06-01 04:18:29.301919', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (18, 10, '2026-05-30', '00:14:33', '00:14:43', 'absent', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Accounts', '2026-05-31 00:14:33.1505', '2026-05-31 00:14:43.488046', NULL, 0, false, 10, '::ffff:127.0.0.1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0', false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (19, 4, '2026-05-01', '10:00:00', '18:30:00', 'full_day', 0, 8.50, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-05-31 15:55:06.402309', '2026-05-31 15:55:06.402309', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (20, 4, '2026-05-02', '10:05:00', '18:25:00', 'full_day', 5, 8.30, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-05-31 15:55:06.402309', '2026-05-31 15:55:06.402309', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (21, 5, '2026-05-01', '10:15:00', '18:45:00', 'full_day', 0, 8.50, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Reception', '2026-05-31 15:55:06.402309', '2026-05-31 15:55:06.402309', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (22, 5, '2026-05-02', '10:10:00', '17:00:00', 'half_day', 0, 6.80, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Reception', '2026-05-31 15:55:06.402309', '2026-05-31 15:55:06.402309', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (23, 6, '2026-05-01', '09:55:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Sales Team', '2026-05-31 15:55:06.402309', '2026-05-31 15:55:06.402309', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (24, 6, '2026-05-02', '10:45:00', '18:30:00', 'full_day', 30, 7.70, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Sales Team', '2026-05-31 15:55:06.402309', '2026-05-31 15:55:06.402309', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (25, 13, '2026-05-01', '10:00:00', '18:30:00', 'full_day', 0, 8.50, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Digital Marketing', '2026-05-31 15:55:06.402309', '2026-05-31 15:55:06.402309', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (26, 13, '2026-05-02', '10:20:00', '18:40:00', 'full_day', 5, 8.30, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Digital Marketing', '2026-05-31 15:55:06.402309', '2026-05-31 15:55:06.402309', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (27, 14, '2026-05-01', '10:05:00', '18:35:00', 'full_day', 5, 8.50, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'IT Department', '2026-05-31 15:55:06.402309', '2026-05-31 15:55:06.402309', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (28, 14, '2026-05-02', '09:50:00', '19:00:00', 'full_day', 0, 9.10, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'IT Department', '2026-05-31 15:55:06.402309', '2026-05-31 15:55:06.402309', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (29, 10, '2026-05-31', '03:33:24', '03:33:29', 'late', 1113, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Accounts', '2026-06-01 03:33:24.989233', '2026-06-01 03:33:29.266203', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (129, 24, '2026-03-05', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (130, 24, '2026-03-06', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (131, 24, '2026-03-07', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (84, 3, '2026-06-03', '14:30:00', '19:30:00', 'half_day', 270, 4.50, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Branch Manager', '2026-06-03 14:30:54.364659', '2026-06-03 14:46:24.591434', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (43, 2, '2026-06-01', '11:00:00', '18:00:00', 'half_day', 45, 7.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-06-01 04:11:53.908873', '2026-06-01 08:07:35.295933', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (56, 18, '2026-06-01', '13:07:01', NULL, 'late', 247, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Process Team', '2026-06-01 13:07:01.584677', '2026-06-01 13:07:01.584677', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (55, 10, '2026-06-01', '09:50:00', '18:00:00', 'full_day', 0, 8.17, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Accounts', '2026-06-01 07:50:10.247193', '2026-06-01 14:44:46.718845', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (75, 12, '2026-06-02', '10:05:00', '19:00:00', 'half_day', 5, 7.92, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-02 22:28:16.935395', '2026-06-02 22:28:26.783746', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (132, 24, '2026-03-09', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (60, 18, '2026-06-02', '10:54:00', '18:00:00', 'late', 114, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Process Team', '2026-06-02 10:54:22.778753', '2026-06-02 18:04:04.173312', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (133, 24, '2026-03-10', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (134, 24, '2026-03-11', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (135, 24, '2026-03-12', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (136, 24, '2026-03-13', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (137, 24, '2026-03-14', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (57, 2, '2026-06-02', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-06-02 10:52:07.603821', '2026-06-02 22:17:14.628332', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (138, 24, '2026-03-16', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (139, 24, '2026-03-17', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (140, 24, '2026-03-18', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (141, 24, '2026-03-19', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (142, 24, '2026-03-20', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (117, 2, '2026-06-04', '11:52:00', '19:00:00', 'half_day', 112, 7.13, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-06-04 11:52:39.087492', '2026-06-04 15:04:10.690618', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (121, 24, '2026-06-04', '00:00:00', '00:00:00', 'absent', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:15:32.963892', '2026-06-04 16:54:18.336342', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (61, 5, '2026-06-02', '09:00:00', '18:00:00', 'full_day', 0, 8.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-02 22:10:49.28339', '2026-06-02 22:26:10.839979', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (71, 6, '2026-06-02', '09:00:00', '18:00:00', 'full_day', 0, 8.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-02 22:20:00.542545', '2026-06-02 22:26:52.963032', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (77, 9, '2026-06-03', '09:00:00', '18:00:00', 'half_day', 0, 8.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-03 13:49:17.049112', '2026-06-03 14:16:01.139466', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (162, 24, '2026-04-21', '00:00:00', '00:00:00', 'full_day', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 18:01:45.76125', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (112, 10, '2026-06-04', '10:16:00', '19:01:00', 'half_day', 16, 8.73, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-03 17:33:24.894336', '2026-06-04 12:15:42.541689', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (125, 9, '2026-06-04', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 12:16:52.111046', '2026-06-04 12:16:52.117769', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (118, 24, '2026-03-02', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:11:13.393062', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (143, 24, '2026-03-21', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (144, 24, '2026-03-23', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (145, 24, '2026-03-24', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (146, 24, '2026-03-25', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (147, 24, '2026-04-01', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (148, 24, '2026-04-02', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (149, 24, '2026-04-03', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (150, 24, '2026-04-04', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (151, 24, '2026-04-06', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (152, 24, '2026-04-07', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (153, 24, '2026-04-08', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (154, 24, '2026-04-09', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (155, 24, '2026-04-10', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (156, 24, '2026-04-11', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (157, 24, '2026-04-13', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (158, 24, '2026-04-15', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (159, 24, '2026-04-16', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (160, 24, '2026-04-17', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (161, 24, '2026-04-20', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (163, 24, '2026-04-22', '00:00:00', '00:00:00', 'absent', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 14:02:45.500419', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (81, 2, '2026-06-03', '14:21:00', '19:00:00', 'half_day', 261, 4.65, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-06-03 14:21:36.486243', '2026-06-03 21:40:52.821811', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (89, 2, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (90, 3, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Branch Manager', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (91, 4, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Branch Manager', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (92, 5, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Reception', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (93, 6, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Sales Team', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (94, 7, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (95, 8, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Sales Team', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (96, 9, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (97, 10, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Accounts', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (98, 11, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'IT Department', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (99, 12, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Digital Marketing Team', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (100, 13, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Digital Marketing Team', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (101, 14, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'IT Department', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (102, 15, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Digital Marketing Team', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (103, 16, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'IT Department', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (104, 17, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'IT Department', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (105, 18, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Process Team', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (106, 19, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Digital Marketing Team', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (107, 20, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Sales Team', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (108, 21, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Accounts', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (109, 22, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Bangalore', 'Reception', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (110, 23, '2026-01-15', NULL, NULL, 'holiday', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'IT Department', '2026-06-03 15:22:26.281991', '2026-06-03 22:34:14.317629', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, 'sankranthi');
INSERT INTO public.attendance_records_backup_20260615 VALUES (164, 24, '2026-04-23', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (165, 24, '2026-04-24', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (166, 24, '2026-04-25', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (167, 24, '2026-04-27', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (168, 24, '2026-04-28', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (169, 24, '2026-05-02', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (170, 24, '2026-05-04', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (171, 24, '2026-05-05', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (172, 24, '2026-05-06', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (173, 24, '2026-05-07', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (174, 24, '2026-05-08', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (175, 24, '2026-05-09', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (176, 24, '2026-05-11', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (177, 24, '2026-05-12', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (178, 24, '2026-05-13', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (179, 24, '2026-05-14', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (180, 24, '2026-05-15', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (181, 24, '2026-05-16', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (182, 24, '2026-05-18', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (183, 24, '2026-05-19', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (184, 24, '2026-05-20', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (185, 24, '2026-05-21', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (186, 24, '2026-05-22', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (187, 24, '2026-05-23', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:27:18.775462', '2026-06-04 12:27:18.775462', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (188, 24, '2026-06-01', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (189, 24, '2026-06-02', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (190, 24, '2026-06-03', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (192, 24, '2026-06-05', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (193, 24, '2026-06-06', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (195, 24, '2026-06-09', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (196, 24, '2026-06-10', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (197, 24, '2026-06-11', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (198, 24, '2026-06-12', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (199, 24, '2026-06-13', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (200, 24, '2026-06-15', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (201, 24, '2026-06-16', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (202, 24, '2026-06-17', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (203, 24, '2026-06-18', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (204, 24, '2026-06-19', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (205, 24, '2026-06-20', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (206, 24, '2026-06-22', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (207, 24, '2026-06-23', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (209, 24, '2026-06-25', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (210, 24, '2026-06-26', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (211, 24, '2026-06-27', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (212, 24, '2026-06-29', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 12:31:37.957074', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (214, 24, '2026-03-26', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 13:22:01.1672', '2026-06-04 13:22:01.214903', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (215, 24, '2026-03-27', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 13:22:22.435054', '2026-06-04 13:22:22.449946', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (216, 24, '2026-03-28', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 13:22:55.999697', '2026-06-04 13:22:56.025688', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (217, 24, '2026-03-30', '10:00:00', '14:30:00', 'half_day', 0, 4.50, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 13:23:17.712808', '2026-06-04 13:23:17.788265', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (220, 24, '2026-05-28', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 14:08:43.982135', '2026-06-04 14:08:44.061087', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (194, 24, '2026-06-08', '10:00:00', '19:00:00', 'absent', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 17:02:20.712371', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (208, 24, '2026-06-24', '10:00:00', '19:00:00', 'full_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 18:01:28.253499', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (221, 24, '2026-05-27', '00:00:00', '00:00:00', 'absent', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 14:09:02.69236', '2026-06-04 14:41:43.666105', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (226, 10, '2026-06-05', '10:16:00', '19:00:00', 'full_day', 16, 8.73, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 15:10:14.551358', '2026-06-04 15:10:14.661804', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (227, 10, '2026-06-06', '10:15:00', '19:00:00', 'full_day', 15, 8.75, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 15:10:47.490165', '2026-06-04 15:10:47.555459', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (213, 24, '2026-06-30', '10:00:00', '19:00:00', 'half_day', 0, 9.00, 0, '[]', '[]', NULL, NULL, NULL, 'Hyderabad', 'Process Team', '2026-06-04 12:31:37.957074', '2026-06-04 16:44:16.804991', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (230, 24, '2026-06-07', NULL, NULL, 'absent', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 16:58:06.537748', '2026-06-04 17:03:59.414962', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (236, 24, '2026-04-30', NULL, NULL, 'full_day', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 18:02:05.926201', '2026-06-04 18:02:05.999096', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (237, 24, '2026-03-31', NULL, NULL, 'full_day', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 18:02:20.371235', '2026-06-04 18:02:20.44364', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (238, 24, '2026-05-01', NULL, NULL, 'full_day', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 18:02:40.584799', '2026-06-04 18:02:40.658368', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);
INSERT INTO public.attendance_records_backup_20260615 VALUES (239, 24, '2026-04-05', NULL, NULL, 'absent', 0, 0.00, 0, '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-06-04 18:04:12.622532', '2026-06-04 18:04:21.035873', NULL, 0, false, NULL, NULL, NULL, false, false, NULL, NULL);


--
-- Data for Name: attendance_summaries; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: branches; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.branches VALUES (1, 'Corporate', 'Corporate', NULL, NULL, NULL, NULL, 'active', '2026-05-17 20:36:08.380033');
INSERT INTO public.branches VALUES (2, 'Hyderabad', 'Hyderabad', NULL, NULL, NULL, 2, 'active', '2026-05-17 20:36:08.380033');
INSERT INTO public.branches VALUES (3, 'Bangalore', 'Bangalore', NULL, NULL, NULL, 3, 'active', '2026-05-17 20:36:08.380033');


--
-- Data for Name: breaks; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: company_holidays; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.company_holidays VALUES (2, '2026-03-31', 'Ugadi', 'holiday', 'all', NULL, '2026-05-30 15:57:06.076065');
INSERT INTO public.company_holidays VALUES (3, '2026-04-14', 'Ambedkar Jayanti', 'holiday', 'all', NULL, '2026-05-30 15:57:06.076065');
INSERT INTO public.company_holidays VALUES (4, '2026-04-18', 'Good Friday', 'holiday', 'all', NULL, '2026-05-30 15:57:06.076065');
INSERT INTO public.company_holidays VALUES (5, '2026-05-01', 'Labour Day', 'holiday', 'all', NULL, '2026-05-30 15:57:06.076065');
INSERT INTO public.company_holidays VALUES (6, '2026-08-15', 'Independence Day', 'holiday', 'all', NULL, '2026-05-30 15:57:06.076065');
INSERT INTO public.company_holidays VALUES (7, '2026-10-02', 'Gandhi Jayanti', 'holiday', 'all', NULL, '2026-05-30 15:57:06.076065');
INSERT INTO public.company_holidays VALUES (8, '2026-10-24', 'Dussehra', 'holiday', 'all', NULL, '2026-05-30 15:57:06.076065');
INSERT INTO public.company_holidays VALUES (9, '2026-11-14', 'Diwali', 'holiday', 'all', NULL, '2026-05-30 15:57:06.076065');
INSERT INTO public.company_holidays VALUES (10, '2026-12-25', 'Christmas', 'holiday', 'all', NULL, '2026-05-30 15:57:06.076065');
INSERT INTO public.company_holidays VALUES (11, '2026-01-15', 'sankranthi', 'holiday', 'all', 1, '2026-06-03 15:22:26.212467');
INSERT INTO public.company_holidays VALUES (19, '2026-01-14', 'ponggal', 'holiday', 'all', 1, '2026-06-03 22:59:59.533715');
INSERT INTO public.company_holidays VALUES (15, '2026-01-01', 'new year', 'holiday', 'all', 1, '2026-06-03 21:52:34.541153');
INSERT INTO public.company_holidays VALUES (1, '2026-01-26', 'republic day', 'holiday', 'all', NULL, '2026-05-30 15:57:06.076065');


--
-- Data for Name: departments; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.departments VALUES (1, 'Branch Manager', 'All', NULL, NULL, '2026-05-17 20:36:08.380033');
INSERT INTO public.departments VALUES (2, 'Reception', 'All', NULL, NULL, '2026-05-17 20:36:08.380033');
INSERT INTO public.departments VALUES (3, 'Sales Team', 'All', NULL, NULL, '2026-05-17 20:36:08.380033');
INSERT INTO public.departments VALUES (4, 'Process Team', 'All', NULL, NULL, '2026-05-17 20:36:08.380033');
INSERT INTO public.departments VALUES (5, 'Accounts', 'All', NULL, NULL, '2026-05-17 20:36:08.380033');
INSERT INTO public.departments VALUES (6, 'IT', 'All', NULL, NULL, '2026-05-17 20:36:08.380033');
INSERT INTO public.departments VALUES (7, 'Digital Marketing Team', 'All', NULL, NULL, '2026-05-17 20:36:08.380033');


--
-- Data for Name: dress_code_exemptions; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: employee_breaks; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.employee_breaks VALUES (46, 2, '2026-05-31', 'break1', '10:51:00', '10:51:00', 0, '2026-05-31 10:51:05.080837', '2026-05-31 10:51:08.899654', NULL, NULL, NULL, NULL, '2026-06-16 10:13:54.413646');
INSERT INTO public.employee_breaks VALUES (47, 2, '2026-05-31', 'lunch', NULL, NULL, 0, '2026-05-31 10:51:05.147263', '2026-05-31 10:51:09.044727', NULL, NULL, NULL, NULL, '2026-06-16 10:13:54.413646');
INSERT INTO public.employee_breaks VALUES (48, 2, '2026-05-31', 'break2', NULL, NULL, 0, '2026-05-31 10:51:05.149244', '2026-05-31 10:51:09.046254', NULL, NULL, NULL, NULL, '2026-06-16 10:13:54.413646');
INSERT INTO public.employee_breaks VALUES (49, 2, '2026-05-31', 'break3', NULL, NULL, 0, '2026-05-31 10:51:05.151235', '2026-05-31 10:51:09.047581', NULL, NULL, NULL, NULL, '2026-06-16 10:13:54.413646');
INSERT INTO public.employee_breaks VALUES (106, 24, '2026-06-16', 'break1', NULL, NULL, 0, '2026-06-16 10:28:31.018787', '2026-06-16 10:28:31.018787', NULL, NULL, 'power off', NULL, '2026-06-16 10:28:31.018787');
INSERT INTO public.employee_breaks VALUES (107, 24, '2026-06-16', 'lunch', NULL, NULL, 0, '2026-06-16 10:28:31.059103', '2026-06-16 10:28:31.059103', NULL, NULL, 'power off', NULL, '2026-06-16 10:28:31.059103');
INSERT INTO public.employee_breaks VALUES (108, 24, '2026-06-16', 'break2', NULL, NULL, 0, '2026-06-16 10:28:31.060833', '2026-06-16 10:28:31.060833', NULL, NULL, 'power off', NULL, '2026-06-16 10:28:31.060833');
INSERT INTO public.employee_breaks VALUES (109, 24, '2026-06-16', 'break3', NULL, NULL, 0, '2026-06-16 10:28:31.06344', '2026-06-16 10:28:31.06344', NULL, NULL, 'power off', NULL, '2026-06-16 10:28:31.06344');


--
-- Data for Name: employee_breaks_backup_20260615; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.employee_breaks_backup_20260615 VALUES (82, 6, '2026-06-02', 'break1', NULL, NULL, 0, '2026-06-02 22:26:52.933679', '2026-06-02 22:26:52.933679', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (83, 6, '2026-06-02', 'lunch', NULL, NULL, 0, '2026-06-02 22:26:52.951158', '2026-06-02 22:26:52.951158', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (84, 6, '2026-06-02', 'break2', NULL, NULL, 0, '2026-06-02 22:26:52.952723', '2026-06-02 22:26:52.952723', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (85, 6, '2026-06-02', 'break3', NULL, NULL, 0, '2026-06-02 22:26:52.953882', '2026-06-02 22:26:52.953882', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (86, 23, '2026-06-02', 'break1', NULL, NULL, 0, '2026-06-02 22:27:13.398472', '2026-06-02 22:27:13.398472', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (87, 23, '2026-06-02', 'lunch', NULL, NULL, 0, '2026-06-02 22:27:13.401134', '2026-06-02 22:27:13.401134', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (88, 23, '2026-06-02', 'break2', NULL, NULL, 0, '2026-06-02 22:27:13.402605', '2026-06-02 22:27:13.402605', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (89, 23, '2026-06-02', 'break3', NULL, NULL, 0, '2026-06-02 22:27:13.403942', '2026-06-02 22:27:13.403942', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (70, 10, '2026-06-02', 'break1', '10:53:00', '14:42:00', 229, '2026-06-02 10:53:03.970482', '2026-06-02 22:27:32.708939', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (71, 10, '2026-06-02', 'lunch', NULL, NULL, 0, '2026-06-02 10:53:03.980182', '2026-06-02 22:27:32.710172', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (72, 10, '2026-06-02', 'break2', NULL, NULL, 0, '2026-06-02 10:53:03.981653', '2026-06-02 22:27:32.711613', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (73, 10, '2026-06-02', 'break3', NULL, NULL, 0, '2026-06-02 10:53:03.982767', '2026-06-02 22:27:32.712775', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (94, 12, '2026-06-02', 'break1', '13:20:00', '14:20:00', 60, '2026-06-02 22:27:50.968663', '2026-06-02 22:27:50.968663', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (95, 12, '2026-06-02', 'lunch', NULL, NULL, 0, '2026-06-02 22:27:50.969807', '2026-06-02 22:27:50.969807', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (96, 12, '2026-06-02', 'break2', NULL, NULL, 0, '2026-06-02 22:27:50.971018', '2026-06-02 22:27:50.971018', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (97, 12, '2026-06-02', 'break3', NULL, NULL, 0, '2026-06-02 22:27:50.972234', '2026-06-02 22:27:50.972234', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (1, 5, '2026-05-30', 'break1', '16:06:00', '16:07:00', 1, '2026-05-30 16:06:57.847145', '2026-05-30 21:15:53.3588', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (2, 5, '2026-05-30', 'lunch', '16:00:00', '16:10:00', 10, '2026-05-30 16:06:57.854694', '2026-05-30 21:15:53.366836', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (3, 5, '2026-05-30', 'break2', '16:07:00', '16:07:00', 0, '2026-05-30 16:06:57.856146', '2026-05-30 21:15:53.368648', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (4, 5, '2026-05-30', 'break3', '16:07:00', '16:10:00', 3, '2026-05-30 16:06:57.857699', '2026-05-30 21:15:53.37036', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (42, 10, '2026-05-30', 'break1', NULL, NULL, 0, '2026-05-31 00:22:03.748576', '2026-05-31 00:22:03.748576', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (43, 10, '2026-05-30', 'lunch', NULL, NULL, 0, '2026-05-31 00:22:03.829713', '2026-05-31 00:22:03.829713', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (44, 10, '2026-05-30', 'break2', '00:22:00', NULL, 0, '2026-05-31 00:22:03.832203', '2026-05-31 00:22:03.832203', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (45, 10, '2026-05-30', 'break3', NULL, NULL, 0, '2026-05-31 00:22:03.835196', '2026-05-31 00:22:03.835196', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (46, 2, '2026-05-31', 'break1', '10:51:00', '10:51:00', 0, '2026-05-31 10:51:05.080837', '2026-05-31 10:51:08.899654', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (47, 2, '2026-05-31', 'lunch', NULL, NULL, 0, '2026-05-31 10:51:05.147263', '2026-05-31 10:51:09.044727', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (48, 2, '2026-05-31', 'break2', NULL, NULL, 0, '2026-05-31 10:51:05.149244', '2026-05-31 10:51:09.046254', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (49, 2, '2026-05-31', 'break3', NULL, NULL, 0, '2026-05-31 10:51:05.151235', '2026-05-31 10:51:09.047581', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (54, 18, '2026-05-31', 'break1', NULL, NULL, 0, '2026-06-01 00:21:56.738958', '2026-06-01 00:22:00.984188', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (55, 18, '2026-05-31', 'lunch', NULL, NULL, 0, '2026-06-01 00:21:56.812073', '2026-06-01 00:22:01.074019', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (56, 18, '2026-05-31', 'break2', '00:21:00', '00:22:00', 1, '2026-06-01 00:21:56.81514', '2026-06-01 00:22:01.076254', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (57, 18, '2026-05-31', 'break3', NULL, NULL, 0, '2026-06-01 00:21:56.816774', '2026-06-01 00:22:01.079051', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (62, 10, '2026-06-01', 'break1', '14:24:00', '14:40:00', 16, '2026-06-01 14:24:23.598102', '2026-06-02 11:14:15.48068', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (63, 10, '2026-06-01', 'lunch', NULL, NULL, 0, '2026-06-01 14:24:23.674544', '2026-06-02 11:14:15.499095', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (64, 10, '2026-06-01', 'break2', NULL, NULL, 0, '2026-06-01 14:24:23.676647', '2026-06-02 11:14:15.500066', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (65, 10, '2026-06-01', 'break3', NULL, NULL, 0, '2026-06-01 14:24:23.678452', '2026-06-02 11:14:15.500794', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (98, 10, '2026-06-03', 'break1', '14:22:00', '17:09:00', 167, '2026-06-03 14:22:23.233648', '2026-06-03 17:09:19.032512', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (99, 10, '2026-06-03', 'lunch', NULL, NULL, 0, '2026-06-03 14:22:23.255498', '2026-06-03 17:09:19.055612', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (100, 10, '2026-06-03', 'break2', NULL, NULL, 0, '2026-06-03 14:22:23.256874', '2026-06-03 17:09:19.059244', NULL, NULL);
INSERT INTO public.employee_breaks_backup_20260615 VALUES (101, 10, '2026-06-03', 'break3', NULL, NULL, 0, '2026-06-03 14:22:23.258392', '2026-06-03 17:09:19.062102', NULL, NULL);


--
-- Data for Name: employee_monthly_summary; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.employee_monthly_summary VALUES (3, 2, '2026-05', 0, 0, 0, '{}', '2026-05-31 10:51:09.053806');


--
-- Data for Name: leave_balance; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.leave_balance VALUES (4066, 1, 2026, 6, 0.0, 0.0, NULL, '2026-06-03 11:42:38.035261', '2026-06-03 11:42:38.035261', 0.0, 1.0, '2026-06-03', 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (31, 2, 2022, 4, 1.0, 0.0, '2022-04-01', '2026-05-31 00:50:06.99258', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2022-04-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (32, 2, 2022, 5, 1.0, 0.0, '2022-05-01', '2026-05-31 00:50:07.015038', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2022-05-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (33, 2, 2022, 6, 1.0, 0.0, '2022-06-01', '2026-05-31 00:50:07.025244', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2022-06-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (34, 2, 2022, 7, 1.0, 0.0, '2022-07-01', '2026-05-31 00:50:07.033267', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2022-07-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (36, 2, 2022, 9, 1.0, 0.0, '2022-09-01', '2026-05-31 00:50:07.049427', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2022-09-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (38, 2, 2022, 11, 1.0, 0.0, '2022-11-01', '2026-05-31 00:50:07.064221', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2022-11-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (39, 2, 2022, 12, 1.0, 0.0, '2022-12-01', '2026-05-31 00:50:07.070095', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2022-12-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (40, 2, 2023, 1, 1.0, 0.0, '2023-01-01', '2026-05-31 00:50:07.07621', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2023-01-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (41, 2, 2023, 2, 1.0, 0.0, '2023-02-01', '2026-05-31 00:50:07.08309', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2023-02-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (42, 2, 2023, 3, 1.0, 0.0, '2023-03-01', '2026-05-31 00:50:07.088504', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2023-03-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (43, 2, 2023, 4, 1.0, 0.0, '2023-04-01', '2026-05-31 00:50:07.093685', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2023-04-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (44, 2, 2023, 5, 1.0, 0.0, '2023-05-01', '2026-05-31 00:50:07.098672', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2023-05-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (45, 2, 2023, 6, 1.0, 0.0, '2023-06-01', '2026-05-31 00:50:07.105139', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2023-06-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (46, 2, 2023, 7, 1.0, 0.0, '2023-07-01', '2026-05-31 00:50:07.11153', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2023-07-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (47, 2, 2023, 8, 1.0, 0.0, '2023-08-01', '2026-05-31 00:50:07.117039', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2023-08-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (48, 2, 2023, 9, 1.0, 0.0, '2023-09-01', '2026-05-31 00:50:07.12649', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2023-09-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (50, 2, 2023, 11, 1.0, 0.0, '2023-11-01', '2026-05-31 00:50:07.20868', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2023-11-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (51, 2, 2023, 12, 1.0, 0.0, '2023-12-01', '2026-05-31 00:50:07.260131', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2023-12-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (54, 2, 2024, 3, 1.0, 0.0, '2024-03-01', '2026-05-31 00:50:07.353773', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2024-03-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (55, 2, 2024, 4, 1.0, 0.0, '2024-04-01', '2026-05-31 00:50:07.478484', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2024-04-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (56, 2, 2024, 5, 1.0, 0.0, '2024-05-01', '2026-05-31 00:50:07.527158', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2024-05-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (58, 2, 2024, 7, 1.0, 0.0, '2024-07-01', '2026-05-31 00:50:07.552713', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2024-07-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (59, 2, 2024, 8, 1.0, 0.0, '2024-08-01', '2026-05-31 00:50:07.562528', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2024-08-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (60, 2, 2024, 9, 1.0, 0.0, '2024-09-01', '2026-05-31 00:50:07.570596', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2024-09-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (63, 2, 2024, 12, 1.0, 0.0, '2024-12-01', '2026-05-31 00:50:07.593782', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2024-12-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (64, 2, 2025, 1, 1.0, 0.0, '2025-01-01', '2026-05-31 00:50:07.599103', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2025-01-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (65, 2, 2025, 2, 1.0, 0.0, '2025-02-01', '2026-05-31 00:50:07.604455', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2025-02-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (67, 2, 2025, 4, 1.0, 0.0, '2025-04-01', '2026-05-31 00:50:07.617261', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2025-04-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (68, 2, 2025, 5, 1.0, 0.0, '2025-05-01', '2026-05-31 00:50:07.623896', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2025-05-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (69, 2, 2025, 6, 1.0, 0.0, '2025-06-01', '2026-05-31 00:50:07.628822', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2025-06-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (70, 2, 2025, 7, 1.0, 0.0, '2025-07-01', '2026-05-31 00:50:07.63338', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2025-07-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (71, 2, 2025, 8, 1.0, 0.0, '2025-08-01', '2026-05-31 00:50:07.639459', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2025-08-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (72, 2, 2025, 9, 1.0, 0.0, '2025-09-01', '2026-05-31 00:50:07.645574', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2025-09-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (73, 2, 2025, 10, 1.0, 0.0, '2025-10-01', '2026-05-31 00:50:07.65194', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2025-10-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (74, 2, 2025, 11, 1.0, 0.0, '2025-11-01', '2026-05-31 00:50:07.658715', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2025-11-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (75, 2, 2025, 12, 1.0, 0.0, '2025-12-01', '2026-05-31 00:50:07.664246', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2025-12-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (76, 2, 2026, 1, 1.0, 0.0, '2026-01-01', '2026-05-31 00:50:07.67175', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2026-01-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (77, 2, 2026, 2, 1.0, 0.0, '2026-02-01', '2026-05-31 00:50:07.676413', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2026-02-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (78, 2, 2026, 3, 1.0, 0.0, '2026-03-01', '2026-05-31 00:50:07.680879', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2026-03-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (79, 2, 2026, 4, 1.0, 0.0, '2026-04-01', '2026-05-31 00:50:07.687174', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2026-04-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (80, 2, 2026, 5, 1.0, 0.0, '2026-05-01', '2026-05-31 00:50:07.693757', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2026-05-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (1, 2, 2019, 10, 1.0, 0.0, '2019-10-01', '2026-05-31 00:50:06.788125', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2019-10-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (2, 2, 2019, 11, 1.0, 0.0, '2019-11-01', '2026-05-31 00:50:06.798131', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2019-11-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (3, 2, 2019, 12, 1.0, 0.0, '2019-12-01', '2026-05-31 00:50:06.804224', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2019-12-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (4, 2, 2020, 1, 1.0, 0.0, '2020-01-01', '2026-05-31 00:50:06.809649', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2020-01-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (5, 2, 2020, 2, 1.0, 0.0, '2020-02-01', '2026-05-31 00:50:06.815239', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2020-02-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (6, 2, 2020, 3, 1.0, 0.0, '2020-03-01', '2026-05-31 00:50:06.82005', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2020-03-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (7, 2, 2020, 4, 1.0, 0.0, '2020-04-01', '2026-05-31 00:50:06.823723', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2020-04-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (8, 2, 2020, 5, 1.0, 0.0, '2020-05-01', '2026-05-31 00:50:06.829378', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2020-05-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (23, 2, 2021, 8, 1.0, 0.0, '2021-08-01', '2026-05-31 00:50:06.912986', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2021-08-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (29, 2, 2022, 2, 1.0, 0.0, '2022-02-01', '2026-05-31 00:50:06.963487', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2022-02-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (61, 2, 2024, 10, 1.0, 0.0, '2024-10-01', '2026-05-31 00:50:07.579588', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2024-10-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (37, 2, 2022, 10, 1.0, 0.0, '2022-10-01', '2026-05-31 00:50:07.058272', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2022-10-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (57, 2, 2024, 6, 1.0, 0.0, '2024-06-01', '2026-05-31 00:50:07.542023', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2024-06-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (4172, 24, 2026, 6, 0.0, 0.0, NULL, '2026-06-04 16:53:47.300622', '2026-06-04 16:55:24.553964', 0.0, 0.0, '2026-06-04', 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0);
INSERT INTO public.leave_balance VALUES (9, 2, 2020, 6, 1.0, 0.0, '2020-06-01', '2026-05-31 00:50:06.83453', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2020-06-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (11, 2, 2020, 8, 1.0, 0.0, '2020-08-01', '2026-05-31 00:50:06.845417', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2020-08-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (13, 2, 2020, 10, 1.0, 0.0, '2020-10-01', '2026-05-31 00:50:06.856421', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2020-10-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (14, 2, 2020, 11, 1.0, 0.0, '2020-11-01', '2026-05-31 00:50:06.862091', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2020-11-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (15, 2, 2020, 12, 1.0, 0.0, '2020-12-01', '2026-05-31 00:50:06.866662', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2020-12-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (16, 2, 2021, 1, 1.0, 0.0, '2021-01-01', '2026-05-31 00:50:06.87177', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2021-01-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (17, 2, 2021, 2, 1.0, 0.0, '2021-02-01', '2026-05-31 00:50:06.877729', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2021-02-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (18, 2, 2021, 3, 1.0, 0.0, '2021-03-01', '2026-05-31 00:50:06.882878', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2021-03-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (19, 2, 2021, 4, 1.0, 0.0, '2021-04-01', '2026-05-31 00:50:06.888113', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2021-04-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (20, 2, 2021, 5, 1.0, 0.0, '2021-05-01', '2026-05-31 00:50:06.893844', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2021-05-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (21, 2, 2021, 6, 1.0, 0.0, '2021-06-01', '2026-05-31 00:50:06.90044', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2021-06-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (22, 2, 2021, 7, 1.0, 0.0, '2021-07-01', '2026-05-31 00:50:06.906394', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2021-07-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (24, 2, 2021, 9, 1.0, 0.0, '2021-09-01', '2026-05-31 00:50:06.918677', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2021-09-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (25, 2, 2021, 10, 1.0, 0.0, '2021-10-01', '2026-05-31 00:50:06.928057', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2021-10-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (26, 2, 2021, 11, 1.0, 0.0, '2021-11-01', '2026-05-31 00:50:06.935118', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2021-11-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (27, 2, 2021, 12, 1.0, 0.0, '2021-12-01', '2026-05-31 00:50:06.94393', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2021-12-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (28, 2, 2022, 1, 1.0, 0.0, '2022-01-01', '2026-05-31 00:50:06.952906', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2022-01-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (30, 2, 2022, 3, 1.0, 0.0, '2022-03-01', '2026-05-31 00:50:06.973419', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2022-03-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (35, 2, 2022, 8, 1.0, 0.0, '2022-08-01', '2026-05-31 00:50:07.042136', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2022-08-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (49, 2, 2023, 10, 1.0, 0.0, '2023-10-01', '2026-05-31 00:50:07.146648', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2023-10-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (52, 2, 2024, 1, 1.0, 0.0, '2024-01-01', '2026-05-31 00:50:07.30112', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2024-01-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (53, 2, 2024, 2, 1.0, 0.0, '2024-02-01', '2026-05-31 00:50:07.331396', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2024-02-01', 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (62, 2, 2024, 11, 1.0, 0.0, '2024-11-01', '2026-05-31 00:50:07.585933', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2024-11-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (66, 2, 2025, 3, 1.0, 0.0, '2025-03-01', '2026-05-31 00:50:07.611126', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2025-03-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (10, 2, 2020, 7, 1.0, 0.0, '2020-07-01', '2026-05-31 00:50:06.839987', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2020-07-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
INSERT INTO public.leave_balance VALUES (4035, 2, 2026, 6, 0.0, 0.0, NULL, '2026-06-02 23:40:18.980067', '2026-06-03 12:36:52.711646', 0.0, 1.0, '2026-06-02', 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0);
INSERT INTO public.leave_balance VALUES (4036, 3, 2026, 6, 0.0, 0.0, NULL, '2026-06-02 23:40:18.980067', '2026-06-03 15:38:21.50222', 0.0, 1.0, '2026-06-02', 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0);
INSERT INTO public.leave_balance VALUES (12, 2, 2020, 9, 1.0, 0.0, '2020-09-01', '2026-05-31 00:50:06.851526', '2026-06-02 23:40:18.980067', 1.0, 0.0, '2020-09-01', 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);


--
-- Data for Name: leave_requests; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.leave_requests VALUES (22, 1, 'Unpaid', '2026-05-25', '2026-05-25', 1, 'Personal errand', 'pending', NULL, NULL, NULL, false, false, 0, NULL, false, false, '2026-05-30 15:57:06.076065', '2026-06-03 12:30:19.421932', false, false, false, 0.0, 0.00, false, 'Unpaid', 0.0, 0.0, false, NULL);
INSERT INTO public.leave_requests VALUES (24, 1, 'Unpaid', '2026-05-10', '2026-05-11', 2, 'Flu', 'approved', NULL, NULL, NULL, false, false, 0, NULL, false, false, '2026-05-30 15:57:06.076065', '2026-06-03 12:30:19.421932', false, false, false, 0.0, 0.00, false, 'Unpaid', 0.0, 0.0, false, NULL);
INSERT INTO public.leave_requests VALUES (26, 2, 'Unpaid', '2026-05-10', '2026-05-11', 2, 'Flu', 'approved', NULL, NULL, NULL, false, false, 0, NULL, false, false, '2026-05-30 15:57:06.076065', '2026-06-03 12:30:19.421932', false, false, false, 0.0, 0.00, false, 'Unpaid', 0.0, 0.0, false, NULL);
INSERT INTO public.leave_requests VALUES (34, 2, 'Unpaid', '2026-06-04', '2026-06-04', 1, 'i am sick', 'approved', 1, '2026-06-03 12:36:52.790129', NULL, false, false, 1, NULL, false, false, '2026-06-03 11:33:31.636756', '2026-06-03 12:36:52.790129', true, false, false, 0.0, 0.00, false, 'Unpaid', 0.0, 1.0, false, '1+1 policy applied: sudden leave or Saturday/Monday abuse');
INSERT INTO public.leave_requests VALUES (36, 3, 'Unpaid', '2026-06-04', '2026-06-04', 1, '', 'approved', 1, '2026-06-03 15:38:21.568022', NULL, false, false, 1, NULL, false, false, '2026-06-03 15:38:03.953565', '2026-06-03 15:38:21.568022', true, false, false, 0.0, 0.00, false, 'Unpaid', 0.0, 1.0, false, '1+1 policy applied: sudden leave or Saturday/Monday abuse');
INSERT INTO public.leave_requests VALUES (38, 24, 'Paid', '2026-06-04', '2026-06-04', 1, '', 'approved', 1, '2026-06-04 16:55:24.557324', NULL, false, false, 0, NULL, false, false, '2026-06-04 16:54:55.760195', '2026-06-04 16:55:24.557324', false, false, true, 0.0, 0.00, false, 'Paid', 1.0, 0.0, false, 'Normal leave approval');
INSERT INTO public.leave_requests VALUES (23, 1, 'Paid', '2026-05-20', '2026-05-22', 3, 'Corporate planning retreat', 'approved', NULL, NULL, NULL, false, false, 0, NULL, false, false, '2026-05-30 15:57:06.076065', '2026-06-03 12:30:19.421932', false, false, true, 0.0, 0.00, false, 'Paid', 0.0, 0.0, false, NULL);
INSERT INTO public.leave_requests VALUES (25, 2, 'Paid', '2026-05-20', '2026-05-22', 3, 'Corporate planning retreat', 'approved', NULL, NULL, NULL, false, false, 0, NULL, false, false, '2026-05-30 15:57:06.076065', '2026-06-03 12:30:19.421932', false, false, true, 0.0, 0.00, false, 'Paid', 0.0, 0.0, false, NULL);


--
-- Data for Name: leaves; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.leaves VALUES (1, 4, 'sick', '2026-05-20', '2026-05-21', 2, 'Fever and cold', 'pending', NULL, '2026-05-17 20:36:08.380033', '2026-05-17 20:36:08.380033');
INSERT INTO public.leaves VALUES (2, 5, 'paid', '2026-05-22', '2026-05-24', 3, 'Family function', 'pending', NULL, '2026-05-17 20:36:08.380033', '2026-05-17 20:36:08.380033');
INSERT INTO public.leaves VALUES (3, 6, 'emergency', '2026-05-18', '2026-05-18', 1, 'Family emergency', 'approved', NULL, '2026-05-17 20:36:08.380033', '2026-05-17 20:36:08.380033');
INSERT INTO public.leaves VALUES (4, 13, 'casual', '2026-05-19', '2026-05-19', 1, 'Personal work', 'approved', NULL, '2026-05-17 20:36:08.380033', '2026-05-17 20:36:08.380033');
INSERT INTO public.leaves VALUES (5, 14, 'sick', '2026-05-23', '2026-05-25', 3, 'Medical appointment', 'pending', NULL, '2026-05-17 20:36:08.380033', '2026-05-17 20:36:08.380033');


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.notifications VALUES (200, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹17,419.32 for March 2026', 139, 'SUPER_ADMIN', false, '2026-06-04 12:33:34.483654');
INSERT INTO public.notifications VALUES (208, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹18,666.76 for April 2026', 148, 'SUPER_ADMIN', false, '2026-06-04 13:09:24.913882');
INSERT INTO public.notifications VALUES (213, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-04 14:19:14.080457');
INSERT INTO public.notifications VALUES (218, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-04 16:37:06.691589');
INSERT INTO public.notifications VALUES (223, 24, 'login', 'Priyanka Vaddi (EMPLOYEE) logged in from Hyderabad branch', NULL, 'BOTH', false, '2026-06-04 16:54:39.776438');
INSERT INTO public.notifications VALUES (229, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹19,677.38 for March 2026', 139, 'SUPER_ADMIN', false, '2026-06-04 18:03:13.874354');
INSERT INTO public.notifications VALUES (234, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-05 12:23:47.241291');
INSERT INTO public.notifications VALUES (239, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-05 14:19:35.82753');
INSERT INTO public.notifications VALUES (243, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-16 10:11:54.360232');
INSERT INTO public.notifications VALUES (2, 3, 'login', 'Bangalore Manager (MANAGER) logged in from Bangalore branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 16:07:11.987952');
INSERT INTO public.notifications VALUES (4, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 16:07:39.875292');
INSERT INTO public.notifications VALUES (6, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 16:13:28.010653');
INSERT INTO public.notifications VALUES (7, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 16:13:52.747572');
INSERT INTO public.notifications VALUES (9, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 16:15:09.083307');
INSERT INTO public.notifications VALUES (12, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 16:16:26.655922');
INSERT INTO public.notifications VALUES (13, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 16:16:37.558321');
INSERT INTO public.notifications VALUES (14, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 16:17:07.821922');
INSERT INTO public.notifications VALUES (15, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 16:17:58.526592');
INSERT INTO public.notifications VALUES (201, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹17,419.32 for March 2026', 139, 'SUPER_ADMIN', false, '2026-06-04 12:33:53.437554');
INSERT INTO public.notifications VALUES (202, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹20,000.1 for June 2026', 142, 'SUPER_ADMIN', false, '2026-06-04 12:34:04.649628');
INSERT INTO public.notifications VALUES (209, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹16,129 for May 2026', 149, 'SUPER_ADMIN', false, '2026-06-04 13:09:46.081738');
INSERT INTO public.notifications VALUES (214, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'BOTH', false, '2026-06-04 14:19:20.383183');
INSERT INTO public.notifications VALUES (219, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-04 16:52:42.363617');
INSERT INTO public.notifications VALUES (224, 24, 'leave_request', '📋 Leave Request: Priyanka Vaddi applied for Paid leave (1 day) — Thu Jun 04 2026 00:00:00 GMT+0530 (India Standard Time) to Thu Jun 04 2026 00:00:00 GMT+0530 (India Standard Time)', 38, 'BOTH', false, '2026-06-04 16:54:55.780042');
INSERT INTO public.notifications VALUES (225, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-04 16:54:59.822515');
INSERT INTO public.notifications VALUES (230, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹19,677.38 for March 2026', 139, 'SUPER_ADMIN', false, '2026-06-04 18:10:57.463973');
INSERT INTO public.notifications VALUES (235, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-05 12:45:09.362056');
INSERT INTO public.notifications VALUES (240, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-05 14:25:24.36925');
INSERT INTO public.notifications VALUES (244, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'BOTH', false, '2026-06-16 10:53:03.170122');
INSERT INTO public.notifications VALUES (67, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 03:44:03.583953');
INSERT INTO public.notifications VALUES (68, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 03:59:06.502035');
INSERT INTO public.notifications VALUES (69, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 07:40:57.273097');
INSERT INTO public.notifications VALUES (70, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 07:42:15.528295');
INSERT INTO public.notifications VALUES (71, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 07:42:28.973913');
INSERT INTO public.notifications VALUES (73, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 08:01:46.655237');
INSERT INTO public.notifications VALUES (74, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 08:25:53.409116');
INSERT INTO public.notifications VALUES (76, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 10:41:30.822452');
INSERT INTO public.notifications VALUES (77, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 13:05:33.159803');
INSERT INTO public.notifications VALUES (78, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 13:06:30.207152');
INSERT INTO public.notifications VALUES (80, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 13:07:29.110976');
INSERT INTO public.notifications VALUES (81, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 13:59:30.326065');
INSERT INTO public.notifications VALUES (83, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 14:17:18.779618');
INSERT INTO public.notifications VALUES (86, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 14:38:48.808319');
INSERT INTO public.notifications VALUES (87, 3, 'payslip_generated', '💰 Payslip Generated: Bangalore Manager — ₹13,333.35 for June 2026', 135, 'SUPER_ADMIN', true, '2026-06-01 14:40:35.418169');
INSERT INTO public.notifications VALUES (88, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 17:16:29.367636');
INSERT INTO public.notifications VALUES (89, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 21:16:15.541077');
INSERT INTO public.notifications VALUES (90, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 21:38:34.073289');
INSERT INTO public.notifications VALUES (91, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 21:39:31.67133');
INSERT INTO public.notifications VALUES (195, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'BOTH', false, '2026-06-04 11:52:36.055601');
INSERT INTO public.notifications VALUES (198, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-04 11:53:10.012416');
INSERT INTO public.notifications VALUES (203, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹20,000.1 for June 2026', 142, 'SUPER_ADMIN', false, '2026-06-04 12:54:30.376295');
INSERT INTO public.notifications VALUES (210, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹19,677.38 for March 2026', 139, 'SUPER_ADMIN', false, '2026-06-04 13:23:39.177925');
INSERT INTO public.notifications VALUES (215, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-04 14:30:58.30751');
INSERT INTO public.notifications VALUES (220, 24, 'login', 'Priyanka Vaddi (EMPLOYEE) logged in from Hyderabad branch', NULL, 'BOTH', false, '2026-06-04 16:53:30.143469');
INSERT INTO public.notifications VALUES (226, 24, 'leave_status', '✅ Leave APPROVED: Priyanka Vaddi''s Paid leave was approved by Super Admin', 38, 'BOTH', false, '2026-06-04 16:55:24.560626');
INSERT INTO public.notifications VALUES (231, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-05 11:49:21.444822');
INSERT INTO public.notifications VALUES (236, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-05 13:17:17.337471');
INSERT INTO public.notifications VALUES (241, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-05 16:19:44.939956');
INSERT INTO public.notifications VALUES (245, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-16 10:53:37.79362');
INSERT INTO public.notifications VALUES (141, 2, 'leave_request', '📋 Leave Request: Hyderabad Manager applied for Unpaid leave (1 day) — Thu Jun 04 2026 00:00:00 GMT+0530 (India Standard Time) to Thu Jun 04 2026 00:00:00 GMT+0530 (India Standard Time)', 34, 'BOTH', true, '2026-06-03 11:33:31.706004');
INSERT INTO public.notifications VALUES (144, 2, 'leave_status', '✅ Leave APPROVED: Hyderabad Manager''s Unpaid leave was approved by Super Admin', 34, 'BOTH', true, '2026-06-03 12:36:52.807797');
INSERT INTO public.notifications VALUES (127, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 15:55:16.784146');
INSERT INTO public.notifications VALUES (128, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 16:02:35.031597');
INSERT INTO public.notifications VALUES (133, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 17:44:34.427404');
INSERT INTO public.notifications VALUES (134, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 21:53:16.062275');
INSERT INTO public.notifications VALUES (135, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 22:19:47.144888');
INSERT INTO public.notifications VALUES (139, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 11:14:04.930642');
INSERT INTO public.notifications VALUES (140, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 11:33:06.444423');
INSERT INTO public.notifications VALUES (142, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 11:33:39.020927');
INSERT INTO public.notifications VALUES (143, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 12:36:46.136832');
INSERT INTO public.notifications VALUES (145, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 12:37:00.783184');
INSERT INTO public.notifications VALUES (148, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 12:37:56.412601');
INSERT INTO public.notifications VALUES (150, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 12:38:12.744681');
INSERT INTO public.notifications VALUES (152, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 12:38:42.121572');
INSERT INTO public.notifications VALUES (153, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 13:48:41.23086');
INSERT INTO public.notifications VALUES (155, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 13:50:08.868687');
INSERT INTO public.notifications VALUES (157, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 13:51:12.984856');
INSERT INTO public.notifications VALUES (167, 3, 'checkin', 'Bangalore Manager checked in at 14:30 ⚠️ 270 min LATE — Bangalore', 84, 'BOTH', true, '2026-06-03 14:30:54.396603');
INSERT INTO public.notifications VALUES (168, 3, 'late_login', '🔴 Late Login: Bangalore Manager is 270 min late — Bangalore / Branch Manager', 84, 'BOTH', true, '2026-06-03 14:30:54.398612');
INSERT INTO public.notifications VALUES (169, 3, 'checkout', 'Bangalore Manager checked out at 14:30 — 0.0 hrs production — Bangalore', 84, 'BOTH', true, '2026-06-03 14:30:58.645931');
INSERT INTO public.notifications VALUES (172, 3, 'leave_request', '📋 Leave Request: Bangalore Manager applied for Unpaid leave (1 day) — Thu Jun 04 2026 00:00:00 GMT+0530 (India Standard Time) to Thu Jun 04 2026 00:00:00 GMT+0530 (India Standard Time)', 36, 'BOTH', true, '2026-06-03 15:38:03.989219');
INSERT INTO public.notifications VALUES (174, 3, 'leave_status', '✅ Leave APPROVED: Bangalore Manager''s Unpaid leave was approved by Super Admin', 36, 'BOTH', true, '2026-06-03 15:38:21.575824');
INSERT INTO public.notifications VALUES (196, 2, 'checkin', 'Hyderabad Manager checked in at 11:52 ⚠️ 112 min LATE — Hyderabad', 117, 'BOTH', false, '2026-06-04 11:52:39.334126');
INSERT INTO public.notifications VALUES (197, 2, 'late_login', '🔴 Late Login: Hyderabad Manager is 112 min late — Hyderabad / Branch Manager', 117, 'BOTH', false, '2026-06-04 11:52:39.338774');
INSERT INTO public.notifications VALUES (162, 2, 'checkin', 'Hyderabad Manager checked in at 14:21 ⚠️ 261 min LATE — Hyderabad', 81, 'BOTH', true, '2026-06-03 14:21:36.54015');
INSERT INTO public.notifications VALUES (163, 2, 'late_login', '🔴 Late Login: Hyderabad Manager is 261 min late — Hyderabad / Branch Manager', 81, 'BOTH', true, '2026-06-03 14:21:36.544561');
INSERT INTO public.notifications VALUES (204, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹17,419.32 for March 2026', 139, 'SUPER_ADMIN', false, '2026-06-04 13:00:07.401941');
INSERT INTO public.notifications VALUES (205, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹20,000.1 for June 2026', 142, 'SUPER_ADMIN', false, '2026-06-04 13:00:36.182221');
INSERT INTO public.notifications VALUES (211, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹17,333.42 for April 2026', 148, 'SUPER_ADMIN', false, '2026-06-04 14:03:43.678105');
INSERT INTO public.notifications VALUES (216, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹16,774.16 for May 2026', 149, 'SUPER_ADMIN', false, '2026-06-04 14:42:25.902273');
INSERT INTO public.notifications VALUES (221, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-04 16:54:01.634749');
INSERT INTO public.notifications VALUES (227, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-04 17:06:50.895444');
INSERT INTO public.notifications VALUES (184, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'BOTH', true, '2026-06-03 16:50:44.54158');
INSERT INTO public.notifications VALUES (232, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-05 12:09:49.838716');
INSERT INTO public.notifications VALUES (237, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-05 13:22:16.129173');
INSERT INTO public.notifications VALUES (242, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-11 15:56:59.406892');
INSERT INTO public.notifications VALUES (246, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'BOTH', false, '2026-06-16 11:15:04.766341');
INSERT INTO public.notifications VALUES (16, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 17:23:33.607627');
INSERT INTO public.notifications VALUES (17, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 21:13:46.14303');
INSERT INTO public.notifications VALUES (19, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 22:43:45.278076');
INSERT INTO public.notifications VALUES (20, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 22:44:01.86343');
INSERT INTO public.notifications VALUES (21, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 22:47:41.221588');
INSERT INTO public.notifications VALUES (22, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 22:48:33.028882');
INSERT INTO public.notifications VALUES (24, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 22:59:47.652139');
INSERT INTO public.notifications VALUES (25, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 23:01:06.397785');
INSERT INTO public.notifications VALUES (26, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-30 23:42:11.8446');
INSERT INTO public.notifications VALUES (177, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 16:02:45.744626');
INSERT INTO public.notifications VALUES (29, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 00:34:01.763834');
INSERT INTO public.notifications VALUES (30, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 00:50:06.769054');
INSERT INTO public.notifications VALUES (32, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 01:02:31.882619');
INSERT INTO public.notifications VALUES (34, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 01:31:42.251131');
INSERT INTO public.notifications VALUES (36, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 01:40:27.547819');
INSERT INTO public.notifications VALUES (37, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 10:44:44.440628');
INSERT INTO public.notifications VALUES (38, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 10:45:59.577394');
INSERT INTO public.notifications VALUES (39, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 10:50:14.442337');
INSERT INTO public.notifications VALUES (40, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 10:51:55.265');
INSERT INTO public.notifications VALUES (41, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 11:27:30.272306');
INSERT INTO public.notifications VALUES (42, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 11:50:53.593773');
INSERT INTO public.notifications VALUES (43, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 11:53:00.656665');
INSERT INTO public.notifications VALUES (44, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 12:38:51.643972');
INSERT INTO public.notifications VALUES (45, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 12:40:12.35538');
INSERT INTO public.notifications VALUES (46, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 12:44:01.858532');
INSERT INTO public.notifications VALUES (47, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 12:44:27.739075');
INSERT INTO public.notifications VALUES (48, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 15:34:46.181676');
INSERT INTO public.notifications VALUES (49, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 16:14:53.923191');
INSERT INTO public.notifications VALUES (50, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 16:15:17.057733');
INSERT INTO public.notifications VALUES (51, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 16:16:38.863819');
INSERT INTO public.notifications VALUES (52, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 21:04:02.597501');
INSERT INTO public.notifications VALUES (53, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 21:44:17.147656');
INSERT INTO public.notifications VALUES (54, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 23:20:13.474792');
INSERT INTO public.notifications VALUES (55, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 23:54:55.34061');
INSERT INTO public.notifications VALUES (56, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 23:56:39.994511');
INSERT INTO public.notifications VALUES (57, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 23:58:00.681798');
INSERT INTO public.notifications VALUES (58, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-05-31 23:59:16.977782');
INSERT INTO public.notifications VALUES (59, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 00:20:41.989325');
INSERT INTO public.notifications VALUES (61, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 01:34:51.828571');
INSERT INTO public.notifications VALUES (62, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 01:35:29.544471');
INSERT INTO public.notifications VALUES (63, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 01:39:14.364248');
INSERT INTO public.notifications VALUES (64, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 02:06:56.768248');
INSERT INTO public.notifications VALUES (96, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 21:48:08.691384');
INSERT INTO public.notifications VALUES (99, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 21:58:23.179229');
INSERT INTO public.notifications VALUES (100, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 21:58:32.360597');
INSERT INTO public.notifications VALUES (105, 3, 'payslip_generated', '💰 Payslip Generated: Bangalore Manager — ₹10,666.58 for June 2026', 135, 'SUPER_ADMIN', true, '2026-06-01 23:02:29.632476');
INSERT INTO public.notifications VALUES (107, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-01 23:24:28.850582');
INSERT INTO public.notifications VALUES (109, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 10:49:16.208805');
INSERT INTO public.notifications VALUES (110, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 10:51:02.722782');
INSERT INTO public.notifications VALUES (113, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 10:55:13.933025');
INSERT INTO public.notifications VALUES (114, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 11:15:30.401045');
INSERT INTO public.notifications VALUES (115, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 11:24:49.69079');
INSERT INTO public.notifications VALUES (116, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 11:41:27.098062');
INSERT INTO public.notifications VALUES (117, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 11:41:53.155167');
INSERT INTO public.notifications VALUES (118, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 11:42:49.357256');
INSERT INTO public.notifications VALUES (119, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 11:48:14.728626');
INSERT INTO public.notifications VALUES (120, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 11:57:57.778087');
INSERT INTO public.notifications VALUES (121, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 12:57:34.200761');
INSERT INTO public.notifications VALUES (124, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 15:26:58.900517');
INSERT INTO public.notifications VALUES (125, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-02 15:27:07.69675');
INSERT INTO public.notifications VALUES (159, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 13:57:03.634663');
INSERT INTO public.notifications VALUES (160, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 13:57:18.959721');
INSERT INTO public.notifications VALUES (161, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 14:21:13.379637');
INSERT INTO public.notifications VALUES (165, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 14:27:53.056965');
INSERT INTO public.notifications VALUES (166, 3, 'login', 'Bangalore Manager (MANAGER) logged in from Bangalore branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 14:30:50.637737');
INSERT INTO public.notifications VALUES (170, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 14:46:51.414989');
INSERT INTO public.notifications VALUES (171, 3, 'login', 'Bangalore Manager (MANAGER) logged in from Bangalore branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 15:37:09.209996');
INSERT INTO public.notifications VALUES (173, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 15:38:12.059641');
INSERT INTO public.notifications VALUES (175, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 15:38:29.431736');
INSERT INTO public.notifications VALUES (176, 3, 'login', 'Bangalore Manager (MANAGER) logged in from Bangalore branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 15:38:42.468805');
INSERT INTO public.notifications VALUES (178, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 16:02:56.501975');
INSERT INTO public.notifications VALUES (179, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 16:04:26.775072');
INSERT INTO public.notifications VALUES (180, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 16:05:59.016719');
INSERT INTO public.notifications VALUES (181, 2, 'login', 'Hyderabad Manager (MANAGER) logged in from Hyderabad branch', NULL, 'SUPER_ADMIN', true, '2026-06-03 16:06:27.126138');
INSERT INTO public.notifications VALUES (183, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', true, '2026-06-03 16:50:34.586767');
INSERT INTO public.notifications VALUES (187, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', true, '2026-06-03 17:03:08.333596');
INSERT INTO public.notifications VALUES (189, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', true, '2026-06-03 17:09:30.116134');
INSERT INTO public.notifications VALUES (190, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', true, '2026-06-03 17:13:16.416032');
INSERT INTO public.notifications VALUES (192, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', true, '2026-06-03 21:36:36.681192');
INSERT INTO public.notifications VALUES (199, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹3,870.96 for March 2026', 139, 'SUPER_ADMIN', false, '2026-06-04 12:07:27.442425');
INSERT INTO public.notifications VALUES (206, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹20,000.1 for June 2026', 142, 'SUPER_ADMIN', false, '2026-06-04 13:08:08.017923');
INSERT INTO public.notifications VALUES (207, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹17,419.32 for March 2026', 139, 'SUPER_ADMIN', false, '2026-06-04 13:08:22.815197');
INSERT INTO public.notifications VALUES (212, 24, 'payslip_generated', '💰 Payslip Generated: Priyanka Vaddi — ₹17,419.32 for May 2026', 149, 'SUPER_ADMIN', false, '2026-06-04 14:09:18.597122');
INSERT INTO public.notifications VALUES (217, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-04 16:34:19.141249');
INSERT INTO public.notifications VALUES (222, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-04 16:54:29.846483');
INSERT INTO public.notifications VALUES (228, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-04 17:41:12.481769');
INSERT INTO public.notifications VALUES (233, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-05 12:13:31.35243');
INSERT INTO public.notifications VALUES (238, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-05 13:32:01.829416');
INSERT INTO public.notifications VALUES (247, 1, 'login', 'Super Admin (SUPER_ADMIN) logged in from Corporate branch', NULL, 'BOTH', false, '2026-06-16 11:36:34.170338');


--
-- Data for Name: offer_letter_actions; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: offer_letter_audit_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: offer_letter_templates; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: offer_letters; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.offer_letters VALUES (1, NULL, 'srikanth', 's@gmial.com', 'uppal', 'team lead', 'aiml', '2026-05-31', '2026-06-09', 600000.00, 40000.00, 'Corporate', 'hyderabed', 'sri', 'VJC-OL-1780259819328', 'SENT', 1, NULL, '/uploads/offer-letters/offer-letter-1-1780261894063.pdf', '2026-06-01 02:25:40.372818', '2026-06-01 02:41:36.969254');
INSERT INTO public.offer_letters VALUES (2, NULL, 'saojijk', 's@gmail.com', 'upal', 'sdzv', 'dcx', '2026-05-31', '2026-06-15', 60000.00, 6000000.00, 'Corporate', 'uppal', 's', 'VJC-OL-1780262175790', 'DRAFT', 1, NULL, '/uploads/offer-letters/offer-letter-2-1780262309701.pdf', '2026-06-01 02:48:25.330156', '2026-06-01 02:48:32.232827');
INSERT INTO public.offer_letters VALUES (3, NULL, 'sczxv', 'edsfx@gmail.com', '', 'fdszxcv', 'fscZd', '2026-05-31', '2026-06-27', 6000.00, 600000.00, 'Corporate', '', '', 'VJC-OL-1780262949756', 'SENT', 1, NULL, '/uploads/offer-letters/offer-letter-3-1780263653187.pdf', '2026-06-01 03:09:28.05613', '2026-06-01 03:10:56.950246');
INSERT INTO public.offer_letters VALUES (4, NULL, 'vikranth', 'vikranth@gmail.com', 'UPPAL', 'dwsx', 'SCXX', '2026-06-03', '2026-06-04', 6000.00, 60000.00, 'Hyderabad', 'Hyderabad', 'DEE', 'VJC-OL-1780487709439', 'SENT', 1, NULL, '/uploads/offer-letters/offer-letter-4-1780487913621.pdf', '2026-06-03 17:28:24.659964', '2026-06-03 17:28:38.698713');


--
-- Data for Name: payroll; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: payslip_records; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.payslip_records VALUES (8, 2, '2026-04-01', 80000.00, 18666.69, 0.00, 0.00, 0.00, 18666.69, 24.00, 1.00, 0.00, 'unpaid', '{"eligible": true, "fullDays": 0, "grossPay": 18666.69, "halfDays": 0, "dailyRate": 2666.67, "absentDays": 24, "lateLogins": 0, "halfDayRate": 1333.34, "payableDays": 7, "sundayCount": 4, "earnedSalary": 18666.69, "holidayCount": 2, "paidLeaveUsed": 1, "totalAbsences": 24, "monthsCompleted": 82, "unpaidLeaveDays": 23, "allowedPaidLeave": 1, "formalLeaveCount": 0, "totalDaysInMonth": 30, "workingDaysCount": 24, "lateLoginHalfDays": 0, "approvedLeaveCount": 0}', '2026-05-30 16:57:52.871086', '2026-05-30 16:57:52.871086', 0.0, 0.00, 0.0, 0.00);
INSERT INTO public.payslip_records VALUES (9, 3, '2026-04-01', 80000.00, 18666.69, 0.00, 0.00, 0.00, 18666.69, 24.00, 1.00, 0.00, 'unpaid', '{"eligible": true, "fullDays": 0, "grossPay": 18666.69, "halfDays": 0, "dailyRate": 2666.67, "absentDays": 24, "lateLogins": 0, "halfDayRate": 1333.34, "payableDays": 7, "sundayCount": 4, "earnedSalary": 18666.69, "holidayCount": 2, "paidLeaveUsed": 1, "totalAbsences": 24, "monthsCompleted": 80, "unpaidLeaveDays": 23, "allowedPaidLeave": 1, "formalLeaveCount": 0, "totalDaysInMonth": 30, "workingDaysCount": 24, "lateLoginHalfDays": 0, "approvedLeaveCount": 0}', '2026-05-30 16:57:53.05969', '2026-05-30 16:57:53.05969', 0.0, 0.00, 0.0, 0.00);
INSERT INTO public.payslip_records VALUES (30, 3, '2026-03-01', 80000.00, 18064.55, 0.00, 0.00, 0.00, 18064.55, 25.00, 1.00, 0.00, 'unpaid', '{"eligible": true, "fullDays": 0, "grossPay": 18064.55, "halfDays": 0, "dailyRate": 2580.65, "absentDays": 25, "lateLogins": 0, "halfDayRate": 1290.33, "payableDays": 7, "sundayCount": 5, "earnedSalary": 18064.55, "holidayCount": 1, "paidLeaveUsed": 1, "totalAbsences": 25, "monthsCompleted": 79, "unpaidLeaveDays": 24, "allowedPaidLeave": 1, "formalLeaveCount": 0, "totalDaysInMonth": 31, "workingDaysCount": 25, "lateLoginHalfDays": 0, "approvedLeaveCount": 0}', '2026-05-30 22:34:46.649893', '2026-05-30 22:34:46.649893', 0.0, 0.00, 0.0, 0.00);
INSERT INTO public.payslip_records VALUES (1, 2, '2026-05-01', 80000.00, 18064.55, 0.00, 0.00, 0.00, 18064.55, 25.00, 1.00, 0.00, 'unpaid', '{"eligible": true, "fullDays": 0, "grossPay": 18064.55, "halfDays": 0, "dailyRate": 2580.65, "absentDays": 21, "lateLogins": 0, "halfDayRate": 1290.33, "payableDays": 7, "sundayCount": 5, "earnedSalary": 18064.55, "holidayCount": 1, "paidLeaveUsed": 1, "totalAbsences": 25, "monthsCompleted": 83, "unpaidLeaveDays": 24, "allowedPaidLeave": 1, "formalLeaveCount": 4, "totalDaysInMonth": 31, "workingDaysCount": 25, "lateLoginHalfDays": 0, "approvedLeaveCount": 4}', '2026-05-30 22:34:36.957313', '2026-05-30 22:34:36.957313', 0.0, 0.00, 0.0, 0.00);
INSERT INTO public.payslip_records VALUES (2, 3, '2026-05-01', 80000.00, 18064.55, 0.00, 0.00, 0.00, 18064.55, 25.00, 1.00, 0.00, 'unpaid', '{"eligible": true, "fullDays": 0, "grossPay": 18064.55, "halfDays": 0, "dailyRate": 2580.65, "absentDays": 25, "lateLogins": 0, "halfDayRate": 1290.33, "payableDays": 7, "sundayCount": 5, "earnedSalary": 18064.55, "holidayCount": 1, "paidLeaveUsed": 1, "totalAbsences": 25, "monthsCompleted": 81, "unpaidLeaveDays": 24, "allowedPaidLeave": 1, "formalLeaveCount": 0, "totalDaysInMonth": 31, "workingDaysCount": 25, "lateLoginHalfDays": 0, "approvedLeaveCount": 0}', '2026-05-30 22:34:37.058286', '2026-05-30 22:34:37.058286', 0.0, 0.00, 0.0, 0.00);
INSERT INTO public.payslip_records VALUES (29, 2, '2026-03-01', 80000.00, 18064.55, 0.00, 0.00, 0.00, 18064.55, 25.00, 1.00, 0.00, 'unpaid', '{"eligible": true, "fullDays": 0, "grossPay": 18064.55, "halfDays": 0, "dailyRate": 2580.65, "absentDays": 25, "lateLogins": 0, "halfDayRate": 1290.33, "payableDays": 7, "sundayCount": 5, "earnedSalary": 18064.55, "holidayCount": 1, "paidLeaveUsed": 1, "totalAbsences": 25, "monthsCompleted": 81, "unpaidLeaveDays": 24, "allowedPaidLeave": 1, "formalLeaveCount": 0, "totalDaysInMonth": 31, "workingDaysCount": 25, "lateLoginHalfDays": 0, "approvedLeaveCount": 0}', '2026-05-30 22:34:46.63387', '2026-05-30 22:34:46.63387', 0.0, 0.00, 0.0, 0.00);
INSERT INTO public.payslip_records VALUES (93, 2, '2026-02-01', 80000.00, 14285.70, 0.00, 0.00, 0.00, 14285.70, 24.00, 1.00, 0.00, 'unpaid', '{"eligible": true, "fullDays": 0, "grossPay": 14285.7, "halfDays": 0, "dailyRate": 2857.14, "absentDays": 24, "lateLogins": 0, "halfDayRate": 1428.57, "payableDays": 5, "sundayCount": 4, "earnedSalary": 14285.7, "holidayCount": 0, "paidLeaveUsed": 1, "totalAbsences": 24, "monthsCompleted": 80, "unpaidLeaveDays": 23, "allowedPaidLeave": 1, "formalLeaveCount": 0, "totalDaysInMonth": 28, "workingDaysCount": 24, "lateLoginHalfDays": 0, "approvedLeaveCount": 0}', '2026-05-30 22:35:01.451163', '2026-05-30 22:35:01.451163', 0.0, 0.00, 0.0, 0.00);
INSERT INTO public.payslip_records VALUES (94, 3, '2026-02-01', 80000.00, 14285.70, 0.00, 0.00, 0.00, 14285.70, 24.00, 1.00, 0.00, 'unpaid', '{"eligible": true, "fullDays": 0, "grossPay": 14285.7, "halfDays": 0, "dailyRate": 2857.14, "absentDays": 24, "lateLogins": 0, "halfDayRate": 1428.57, "payableDays": 5, "sundayCount": 4, "earnedSalary": 14285.7, "holidayCount": 0, "paidLeaveUsed": 1, "totalAbsences": 24, "monthsCompleted": 78, "unpaidLeaveDays": 23, "allowedPaidLeave": 1, "formalLeaveCount": 0, "totalDaysInMonth": 28, "workingDaysCount": 24, "lateLoginHalfDays": 0, "approvedLeaveCount": 0}', '2026-05-30 22:35:01.525015', '2026-05-30 22:35:01.525015', 0.0, 0.00, 0.0, 0.00);
INSERT INTO public.payslip_records VALUES (149, 24, '2026-05-01', 20000.00, 16774.16, 0.00, 0.00, 0.00, 16774.16, 25.00, 20.00, 0.00, 'paid', '{"eligible": true, "fullDays": 20, "grossPay": 16774.16, "halfDays": 0, "dailyRate": 645.16, "absentDays": 5, "lateLogins": 0, "sundayCount": 5, "earnedSalary": 16774.16, "holidayCount": 1, "paidLeaveUsed": 0, "totalAbsences": 0, "monthsCompleted": 27, "unpaidLeaveDays": 0, "allowedPaidLeave": 1, "formalLeaveCount": 0, "totalDaysInMonth": 31, "workingDaysCount": 25, "lateLoginHalfDays": 0, "approvedLeaveCount": 0}', '2026-06-04 13:09:46.059171', '2026-06-04 14:42:25.886541', 0.0, 3225.84, 0.0, 0.00);
INSERT INTO public.payslip_records VALUES (114, 2, '2026-07-01', 80000.00, 12903.25, 0.00, 0.00, 0.00, 12903.25, 27.00, 1.00, 0.00, 'unpaid', '{"eligible": true, "fullDays": 0, "grossPay": 12903.25, "halfDays": 0, "dailyRate": 2580.65, "absentDays": 27, "lateLogins": 0, "halfDayRate": 1290.33, "payableDays": 5, "sundayCount": 4, "earnedSalary": 12903.25, "holidayCount": 0, "paidLeaveUsed": 1, "totalAbsences": 27, "monthsCompleted": 85, "unpaidLeaveDays": 26, "allowedPaidLeave": 1, "formalLeaveCount": 0, "totalDaysInMonth": 31, "workingDaysCount": 27, "lateLoginHalfDays": 0, "approvedLeaveCount": 0}', '2026-05-30 22:36:06.694314', '2026-05-30 22:36:06.694314', 0.0, 0.00, 0.0, 0.00);
INSERT INTO public.payslip_records VALUES (115, 3, '2026-07-01', 80000.00, 12903.25, 0.00, 0.00, 0.00, 12903.25, 27.00, 1.00, 0.00, 'unpaid', '{"eligible": true, "fullDays": 0, "grossPay": 12903.25, "halfDays": 0, "dailyRate": 2580.65, "absentDays": 27, "lateLogins": 0, "halfDayRate": 1290.33, "payableDays": 5, "sundayCount": 4, "earnedSalary": 12903.25, "holidayCount": 0, "paidLeaveUsed": 1, "totalAbsences": 27, "monthsCompleted": 83, "unpaidLeaveDays": 26, "allowedPaidLeave": 1, "formalLeaveCount": 0, "totalDaysInMonth": 31, "workingDaysCount": 27, "lateLoginHalfDays": 0, "approvedLeaveCount": 0}', '2026-05-30 22:36:06.745816', '2026-05-30 22:36:06.745816', 0.0, 0.00, 0.0, 0.00);
INSERT INTO public.payslip_records VALUES (135, 3, '2026-06-01', 80000.00, 10666.58, 0.00, 69333.42, 0.00, 10666.58, 26.00, 0.00, 0.00, 'unpaid', '{"eligible": true, "fullDays": 0, "grossPay": 80000, "halfDays": 0, "dailyRate": 2666.67, "absentDays": 26, "lateLogins": 0, "sundayCount": 4, "earnedSalary": 10666.58, "holidayCount": 0, "paidLeaveUsed": 0, "totalAbsences": 26, "monthsCompleted": 82, "unpaidLeaveDays": 26, "allowedPaidLeave": 1, "formalLeaveCount": 0, "totalDaysInMonth": 30, "workingDaysCount": 26, "lateLoginHalfDays": 0, "approvedLeaveCount": 0}', '2026-06-01 14:40:35.115348', '2026-06-01 23:02:29.525574', 26.0, 69333.42, 0.0, 0.00);
INSERT INTO public.payslip_records VALUES (142, 24, '2026-06-01', 20000.00, 20000.10, 0.00, 0.00, 0.00, 20000.10, 26.00, 26.00, 0.00, 'unpaid', '{"eligible": true, "fullDays": 26, "grossPay": 20000.1, "halfDays": 0, "dailyRate": 666.67, "absentDays": 0, "lateLogins": 0, "sundayCount": 4, "earnedSalary": 20000.1, "holidayCount": 0, "paidLeaveUsed": 0, "totalAbsences": 0, "monthsCompleted": 28, "unpaidLeaveDays": 0, "allowedPaidLeave": 1, "formalLeaveCount": 0, "totalDaysInMonth": 30, "workingDaysCount": 26, "lateLoginHalfDays": 0, "approvedLeaveCount": 0}', '2026-06-04 12:34:04.642319', '2026-06-04 13:08:08.001837', 0.0, -0.10, 0.0, 0.00);
INSERT INTO public.payslip_records VALUES (148, 24, '2026-04-01', 20000.00, 17333.42, 0.00, 0.00, 0.00, 17333.42, 24.00, 20.00, 0.00, 'paid', '{"eligible": true, "fullDays": 20, "grossPay": 17333.42, "halfDays": 0, "dailyRate": 666.67, "absentDays": 4, "lateLogins": 0, "sundayCount": 4, "earnedSalary": 17333.42, "holidayCount": 2, "paidLeaveUsed": 0, "totalAbsences": 0, "monthsCompleted": 26, "unpaidLeaveDays": 0, "allowedPaidLeave": 1, "formalLeaveCount": 0, "totalDaysInMonth": 30, "workingDaysCount": 24, "lateLoginHalfDays": 0, "approvedLeaveCount": 0}', '2026-06-04 13:09:24.83141', '2026-06-04 14:06:14.230035', 0.0, 2666.58, 0.0, 0.00);
INSERT INTO public.payslip_records VALUES (139, 24, '2026-03-01', 20000.00, 19677.38, 0.00, 0.00, 0.00, 19677.38, 25.00, 24.50, 0.00, 'paid', '{"eligible": true, "fullDays": 24, "grossPay": 19677.38, "halfDays": 1, "dailyRate": 645.16, "absentDays": 0, "lateLogins": 0, "sundayCount": 5, "earnedSalary": 19677.38, "holidayCount": 1, "paidLeaveUsed": 0, "totalAbsences": 0, "monthsCompleted": 25, "unpaidLeaveDays": 0, "allowedPaidLeave": 1, "formalLeaveCount": 0, "totalDaysInMonth": 31, "workingDaysCount": 25, "lateLoginHalfDays": 0, "approvedLeaveCount": 0}', '2026-06-04 12:07:27.350294', '2026-06-04 18:11:00.96032', 0.0, 322.62, 0.0, 0.00);


--
-- Data for Name: phone_deposit_log; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: policy_config; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.policy_config VALUES ('office_start_time', '10:00:00', 'Standard shift start', '2026-05-31 00:10:08.958211');
INSERT INTO public.policy_config VALUES ('office_end_time', '19:00:00', 'Standard shift end', '2026-05-31 00:10:08.958211');
INSERT INTO public.policy_config VALUES ('grace_login_time', '10:15:00', 'Latest on-time login', '2026-05-31 00:10:08.958211');
INSERT INTO public.policy_config VALUES ('max_late_logins_per_month', '6', 'Grace-period late logins allowed per month', '2026-05-31 00:10:08.958211');
INSERT INTO public.policy_config VALUES ('min_full_day_hours', '8', 'Net hours for full day', '2026-05-31 00:10:08.958211');
INSERT INTO public.policy_config VALUES ('min_half_day_hours', '4', 'Net hours minimum for half day', '2026-05-31 00:10:08.958211');
INSERT INTO public.policy_config VALUES ('max_break_minutes_per_day', '60', 'Total break allowance', '2026-05-31 00:10:08.958211');
INSERT INTO public.policy_config VALUES ('post_login_idle_threshold_minutes', '15', 'Idle after login before flag', '2026-05-31 00:10:08.958211');
INSERT INTO public.policy_config VALUES ('sat_mon_leave_limit_per_month', '1', 'Max Sat/Mon leaves combined', '2026-05-31 00:10:08.958211');
INSERT INTO public.policy_config VALUES ('medical_doc_submission_days', '2', 'Working days to submit medical proof', '2026-05-31 00:10:08.958211');
INSERT INTO public.policy_config VALUES ('daily_recalc_cron_time', '19:15', 'HH:MM office-local daily recalc', '2026-05-31 00:10:08.958211');
INSERT INTO public.policy_config VALUES ('timezone', 'Asia/Kolkata', 'Cron timezone', '2026-05-31 00:10:08.958211');
INSERT INTO public.policy_config VALUES ('PAID_LEAVE_PROBATION_MONTHS', '3', 'Months from joining before paid leave starts', '2026-05-31 00:47:31.237625');
INSERT INTO public.policy_config VALUES ('PAID_LEAVE_PER_MONTH', '1', 'Paid leave days credited per month after probation', '2026-05-31 00:47:31.237625');
INSERT INTO public.policy_config VALUES ('EARNED_LEAVE_PROBATION_MONTHS', '3', 'Months before employee qualifies for earned leave', '2026-05-31 00:47:31.237625');
INSERT INTO public.policy_config VALUES ('EARNED_LEAVE_PER_MONTH', '1', 'Earned leave days accrued per month after probation', '2026-05-31 00:47:31.237625');
INSERT INTO public.policy_config VALUES ('yearly_sick_leave_limit', '6', 'Maximum sick leaves per year', '2026-06-01 20:44:27.54217');
INSERT INTO public.policy_config VALUES ('yearly_casual_leave_limit', '6', 'Maximum casual leaves per year', '2026-06-01 20:44:27.54217');
INSERT INTO public.policy_config VALUES ('saturday_paid_leave_protect_sunday', 'true', 'Paid leave on Saturday protects Sunday', '2026-06-01 20:44:27.54217');
INSERT INTO public.policy_config VALUES ('saturday_unpaid_leave_requires_admin_decision', 'true', 'Admin decides Sunday penalty', '2026-06-01 20:44:27.54217');
INSERT INTO public.policy_config VALUES ('dress_code_penalty_default', 'half_day', 'Default dress code penalty', '2026-06-01 20:44:27.54217');
INSERT INTO public.policy_config VALUES ('late_login_grace_time', '10:15:00', 'Maximum allowed grace login', '2026-06-01 20:44:27.54217');
INSERT INTO public.policy_config VALUES ('minimum_full_day_hours', '8', 'Hours required for full day', '2026-06-01 20:44:27.54217');
INSERT INTO public.policy_config VALUES ('minimum_half_day_hours', '4', 'Hours required for half day', '2026-06-01 20:44:27.54217');
INSERT INTO public.policy_config VALUES ('half_day_slot_a', '10:00-14:30', 'Morning half day slot', '2026-06-01 20:44:27.54217');
INSERT INTO public.policy_config VALUES ('half_day_slot_b', '14:30-19:00', 'Evening half day slot', '2026-06-01 20:44:27.54217');
INSERT INTO public.policy_config VALUES ('paid_leave_per_month', '1', 'One paid leave credited every month after probation', '2026-06-02 22:48:15.335743');
INSERT INTO public.policy_config VALUES ('paid_leave_probation_months', '3', 'Paid leave starts after probation', '2026-06-02 22:48:15.335743');
INSERT INTO public.policy_config VALUES ('allow_leave_carry_forward', 'true', 'Unused paid leave carries forward', '2026-06-02 22:48:15.335743');
INSERT INTO public.policy_config VALUES ('allow_future_leave_usage', 'false', 'Future month leave cannot be used', '2026-06-02 22:48:15.335743');


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.users VALUES (1, 'Super Admin', 'admin@hrms.com', '$2b$10$E3yFYIqYOLGleRo2W5f1Y.bQsczLM04Fro4QZ7bKn2Cno2CoNq1cC', 'Admin@123', 'SUPER_ADMIN', 'Administration', 'Corporate', 'VJC1001', 120000.00, '2020-01-01', 'active', 'SA', NULL, NULL, NULL, NULL, NULL, '2026-05-30 15:57:06.076065', '2026-05-30 15:57:06.076065');
INSERT INTO public.users VALUES (2, 'Hyderabad Manager', 'manager.hyd@hrms.com', '$2b$10$wfrP9SqWq22.Q3A8yUWrKO7kivIOWbxcrQ6rsuazqA.qL.obVK42a', 'Manager@123', 'MANAGER', 'Branch Manager', 'Hyderabad', 'VJC1002', 80000.00, '2019-06-15', 'active', 'HM', NULL, NULL, NULL, NULL, NULL, '2026-05-30 15:57:06.076065', '2026-05-30 15:57:06.076065');
INSERT INTO public.users VALUES (3, 'Bangalore Manager', 'manager.blr@hrms.com', '$2b$10$wfrP9SqWq22.Q3A8yUWrKO7kivIOWbxcrQ6rsuazqA.qL.obVK42a', 'Manager@123', 'MANAGER', 'Branch Manager', 'Bangalore', 'VJC1003', 80000.00, '2019-08-20', 'active', 'BM', NULL, NULL, NULL, NULL, NULL, '2026-05-30 15:57:06.076065', '2026-05-30 15:57:06.076065');
INSERT INTO public.users VALUES (24, 'Priyanka Vaddi', 'priyanka.vaddi@vjcoverseas.com', '$2b$10$lHWOmFka1p.pP9bkKdLFYe5EMBVU.p8/qziqW1QOYoHTkl44H2iVu', 'priya@2026', 'EMPLOYEE', 'Process Team', 'Hyderabad', 'VJC-HYD- -10009-007', 20000.00, '2024-02-26', 'active', 'PV', 'Immigration Process Consultant', 'HDFC', '50100750568875', 'HDFC0007885', NULL, '2026-06-04 12:02:54.413463', '2026-06-04 16:53:06.91592');


--
-- Data for Name: violation_records; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Name: activity_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.activity_logs_id_seq', 153, true);


--
-- Name: attendance_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.attendance_history_id_seq', 2, true);


--
-- Name: attendance_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.attendance_id_seq', 808, true);


--
-- Name: attendance_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.attendance_records_id_seq', 242, true);


--
-- Name: attendance_summaries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.attendance_summaries_id_seq', 1, false);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.audit_logs_id_seq', 1, false);


--
-- Name: branches_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.branches_id_seq', 6, true);


--
-- Name: breaks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.breaks_id_seq', 1, false);


--
-- Name: company_holidays_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.company_holidays_id_seq', 21, true);


--
-- Name: departments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.departments_id_seq', 14, true);


--
-- Name: dress_code_exemptions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.dress_code_exemptions_id_seq', 1, false);


--
-- Name: employee_breaks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.employee_breaks_id_seq', 109, true);


--
-- Name: employee_monthly_summary_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.employee_monthly_summary_id_seq', 4, true);


--
-- Name: leave_balance_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.leave_balance_id_seq', 4182, true);


--
-- Name: leave_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.leave_requests_id_seq', 38, true);


--
-- Name: leaves_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.leaves_id_seq', 5, true);


--
-- Name: notifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.notifications_id_seq', 247, true);


--
-- Name: offer_letter_actions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.offer_letter_actions_id_seq', 1, false);


--
-- Name: offer_letter_audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.offer_letter_audit_logs_id_seq', 1, false);


--
-- Name: offer_letter_templates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.offer_letter_templates_id_seq', 1, false);


--
-- Name: offer_letters_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.offer_letters_id_seq', 4, true);


--
-- Name: payroll_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payroll_id_seq', 1, false);


--
-- Name: payslip_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payslip_records_id_seq', 155, true);


--
-- Name: phone_deposit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.phone_deposit_log_id_seq', 1, false);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 24, true);


--
-- Name: violation_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.violation_records_id_seq', 2, true);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: attendance_history attendance_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_history
    ADD CONSTRAINT attendance_history_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: attendance_records attendance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_pkey PRIMARY KEY (id);


--
-- Name: attendance_records attendance_records_user_id_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_user_id_date_key UNIQUE (user_id, date);


--
-- Name: attendance_summaries attendance_summaries_month_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_summaries
    ADD CONSTRAINT attendance_summaries_month_key UNIQUE (month);


--
-- Name: attendance_summaries attendance_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_summaries
    ADD CONSTRAINT attendance_summaries_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_user_id_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_user_id_date_key UNIQUE (user_id, date);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: branches branches_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_name_key UNIQUE (name);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: breaks breaks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.breaks
    ADD CONSTRAINT breaks_pkey PRIMARY KEY (id);


--
-- Name: company_holidays company_holidays_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.company_holidays
    ADD CONSTRAINT company_holidays_date_key UNIQUE (date);


--
-- Name: company_holidays company_holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.company_holidays
    ADD CONSTRAINT company_holidays_pkey PRIMARY KEY (id);


--
-- Name: departments departments_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_name_key UNIQUE (name);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: dress_code_exemptions dress_code_exemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dress_code_exemptions
    ADD CONSTRAINT dress_code_exemptions_pkey PRIMARY KEY (id);


--
-- Name: dress_code_exemptions dress_code_exemptions_user_id_exemption_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dress_code_exemptions
    ADD CONSTRAINT dress_code_exemptions_user_id_exemption_date_key UNIQUE (user_id, exemption_date);


--
-- Name: employee_breaks employee_breaks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_breaks
    ADD CONSTRAINT employee_breaks_pkey PRIMARY KEY (id);


--
-- Name: employee_breaks employee_breaks_user_id_date_break_type_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_breaks
    ADD CONSTRAINT employee_breaks_user_id_date_break_type_key UNIQUE (user_id, date, break_type);


--
-- Name: employee_monthly_summary employee_monthly_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_monthly_summary
    ADD CONSTRAINT employee_monthly_summary_pkey PRIMARY KEY (id);


--
-- Name: employee_monthly_summary employee_monthly_summary_user_id_month_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_monthly_summary
    ADD CONSTRAINT employee_monthly_summary_user_id_month_key UNIQUE (user_id, month);


--
-- Name: leave_balance leave_balance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leave_balance
    ADD CONSTRAINT leave_balance_pkey PRIMARY KEY (id);


--
-- Name: leave_balance leave_balance_user_id_year_month_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leave_balance
    ADD CONSTRAINT leave_balance_user_id_year_month_key UNIQUE (user_id, year, month);


--
-- Name: leave_requests leave_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_pkey PRIMARY KEY (id);


--
-- Name: leaves leaves_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leaves
    ADD CONSTRAINT leaves_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: offer_letter_actions offer_letter_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offer_letter_actions
    ADD CONSTRAINT offer_letter_actions_pkey PRIMARY KEY (id);


--
-- Name: offer_letter_audit_logs offer_letter_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offer_letter_audit_logs
    ADD CONSTRAINT offer_letter_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: offer_letter_templates offer_letter_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offer_letter_templates
    ADD CONSTRAINT offer_letter_templates_pkey PRIMARY KEY (id);


--
-- Name: offer_letters offer_letters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offer_letters
    ADD CONSTRAINT offer_letters_pkey PRIMARY KEY (id);


--
-- Name: offer_letters offer_letters_reference_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offer_letters
    ADD CONSTRAINT offer_letters_reference_number_key UNIQUE (reference_number);


--
-- Name: payroll payroll_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payroll
    ADD CONSTRAINT payroll_pkey PRIMARY KEY (id);


--
-- Name: payroll payroll_user_id_month_year_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payroll
    ADD CONSTRAINT payroll_user_id_month_year_key UNIQUE (user_id, month, year);


--
-- Name: payslip_records payslip_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payslip_records
    ADD CONSTRAINT payslip_records_pkey PRIMARY KEY (id);


--
-- Name: payslip_records payslip_records_user_id_month_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payslip_records
    ADD CONSTRAINT payslip_records_user_id_month_key UNIQUE (user_id, month);


--
-- Name: phone_deposit_log phone_deposit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.phone_deposit_log
    ADD CONSTRAINT phone_deposit_log_pkey PRIMARY KEY (id);


--
-- Name: policy_config policy_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.policy_config
    ADD CONSTRAINT policy_config_pkey PRIMARY KEY (config_key);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_employee_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_employee_code_key UNIQUE (employee_code);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: violation_records violation_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.violation_records
    ADD CONSTRAINT violation_records_pkey PRIMARY KEY (id);


--
-- Name: idx_ah_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ah_date ON public.attendance_history USING btree (date);


--
-- Name: idx_ah_edited_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ah_edited_at ON public.attendance_history USING btree (edited_at DESC);


--
-- Name: idx_ah_edited_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ah_edited_by ON public.attendance_history USING btree (edited_by_email);


--
-- Name: idx_ah_employee_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ah_employee_email ON public.attendance_history USING btree (employee_email);


--
-- Name: idx_ah_original_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ah_original_id ON public.attendance_history USING btree (original_attendance_id);


--
-- Name: idx_al_action; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_al_action ON public.activity_logs USING btree (action);


--
-- Name: idx_al_branch; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_al_branch ON public.activity_logs USING btree (branch);


--
-- Name: idx_al_module_action; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_al_module_action ON public.activity_logs USING btree (module_name, action_type);


--
-- Name: idx_al_severity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_al_severity ON public.activity_logs USING btree (severity);


--
-- Name: idx_al_timestamp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_al_timestamp ON public.activity_logs USING btree ("timestamp" DESC);


--
-- Name: idx_al_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_al_user_id ON public.activity_logs USING btree (user_id);


--
-- Name: idx_al_user_ts; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_al_user_ts ON public.activity_logs USING btree (user_id, "timestamp" DESC);


--
-- Name: idx_as_month; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_as_month ON public.attendance_summaries USING btree (month);


--
-- Name: idx_as_saved_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_as_saved_at ON public.attendance_summaries USING btree (saved_at DESC);


--
-- Name: idx_att_branch; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_att_branch ON public.attendance_records USING btree (branch);


--
-- Name: idx_att_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_att_date ON public.attendance_records USING btree (date);


--
-- Name: idx_att_date_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_att_date_status ON public.attendance_records USING btree (date, status) WHERE ((status)::text = ANY ((ARRAY['full_day'::character varying, 'half_day'::character varying, 'absent'::character varying])::text[]));


--
-- Name: idx_att_date_status_late; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_att_date_status_late ON public.attendance_records USING btree (date, status, late_minutes) WHERE ((status)::text = ANY ((ARRAY['full_day'::character varying, 'half_day'::character varying, 'absent'::character varying, 'leave'::character varying])::text[]));


--
-- Name: idx_att_extra_break_ins; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_att_extra_break_ins ON public.attendance_records USING gin (extra_break_ins);


--
-- Name: idx_att_extra_break_outs; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_att_extra_break_outs ON public.attendance_records USING gin (extra_break_outs);


--
-- Name: idx_att_late; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_att_late ON public.attendance_records USING btree (user_id, date) WHERE (late_minutes > 0);


--
-- Name: idx_att_leave_request; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_att_leave_request ON public.attendance_records USING btree (leave_request_id) WHERE (leave_request_id IS NOT NULL);


--
-- Name: idx_att_leave_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_att_leave_status ON public.attendance_records USING btree (leave_status) WHERE (leave_status IS NOT NULL);


--
-- Name: idx_att_logged_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_att_logged_by ON public.attendance_records USING btree (logged_by_user_id);


--
-- Name: idx_att_proxy; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_att_proxy ON public.attendance_records USING btree (proxy_attempt) WHERE (proxy_attempt = true);


--
-- Name: idx_att_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_att_status ON public.attendance_records USING btree (status);


--
-- Name: idx_att_user_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_att_user_date ON public.attendance_records USING btree (user_id, date);


--
-- Name: idx_att_user_date_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_att_user_date_status ON public.attendance_records USING btree (user_id, date DESC, status);


--
-- Name: idx_audit_action_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_action_type ON public.audit_logs USING btree (action_type);


--
-- Name: idx_audit_branch; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_branch ON public.audit_logs USING btree (branch);


--
-- Name: idx_audit_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_created_at ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_module; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_module ON public.audit_logs USING btree (module_name);


--
-- Name: idx_audit_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_user_id ON public.audit_logs USING btree (user_id);


--
-- Name: idx_breaks_user_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_breaks_user_date ON public.employee_breaks USING btree (user_id, date, break_type);


--
-- Name: idx_eb_break_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_eb_break_type ON public.employee_breaks USING btree (break_type);


--
-- Name: idx_eb_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_eb_date ON public.employee_breaks USING btree (date);


--
-- Name: idx_eb_user_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_eb_user_date ON public.employee_breaks USING btree (user_id, date);


--
-- Name: idx_ems_user_month; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ems_user_month ON public.employee_monthly_summary USING btree (user_id, month);


--
-- Name: idx_holidays_branch; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_holidays_branch ON public.company_holidays USING btree (branch);


--
-- Name: idx_holidays_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_holidays_date ON public.company_holidays USING btree (date);


--
-- Name: idx_holidays_date_branch; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_holidays_date_branch ON public.company_holidays USING btree (date, branch);


--
-- Name: idx_lb_user_year_month; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lb_user_year_month ON public.leave_balance USING btree (user_id, year, month);


--
-- Name: idx_leaves_approved_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_leaves_approved_by ON public.leave_requests USING btree (approved_by);


--
-- Name: idx_leaves_dates; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_leaves_dates ON public.leave_requests USING btree (from_date, to_date);


--
-- Name: idx_leaves_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_leaves_status ON public.leave_requests USING btree (status);


--
-- Name: idx_leaves_user_approved; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_leaves_user_approved ON public.leave_requests USING btree (user_id, from_date, to_date) WHERE ((status)::text = 'approved'::text);


--
-- Name: idx_leaves_user_dates_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_leaves_user_dates_status ON public.leave_requests USING btree (user_id, from_date, to_date) WHERE ((status)::text = 'approved'::text);


--
-- Name: idx_leaves_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_leaves_user_id ON public.leave_requests USING btree (user_id);


--
-- Name: idx_mv_branch_month; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mv_branch_month ON public.mv_monthly_attendance USING btree (branch, month_start);


--
-- Name: idx_mv_dept_month; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mv_dept_month ON public.mv_monthly_attendance USING btree (department, month_start);


--
-- Name: idx_mv_monthly_attendance; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_mv_monthly_attendance ON public.mv_monthly_attendance USING btree (user_id, month_start);


--
-- Name: idx_mv_payroll_month; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mv_payroll_month ON public.mv_payroll_monthly USING btree (month DESC);


--
-- Name: idx_mv_payroll_monthly_pk; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_mv_payroll_monthly_pk ON public.mv_payroll_monthly USING btree (month, branch, department);


--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);


--
-- Name: idx_notifications_target_role; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_target_role ON public.notifications USING btree (target_role);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (is_read) WHERE (is_read = false);


--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id);


--
-- Name: idx_offer_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_offer_created_at ON public.offer_letters USING btree (created_at);


--
-- Name: idx_offer_employee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_offer_employee ON public.offer_letters USING btree (employee_id);


--
-- Name: idx_offer_ref; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_offer_ref ON public.offer_letters USING btree (reference_number);


--
-- Name: idx_offer_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_offer_status ON public.offer_letters USING btree (status);


--
-- Name: idx_payslip_month_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payslip_month_status ON public.payslip_records USING btree (month, payment_status);


--
-- Name: idx_payslip_payment_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payslip_payment_status ON public.payslip_records USING btree (payment_status);


--
-- Name: idx_payslip_user_month; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payslip_user_month ON public.payslip_records USING btree (user_id, month DESC);


--
-- Name: idx_phone_deposit_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_phone_deposit_user ON public.phone_deposit_log USING btree (user_id, deposited_at DESC);


--
-- Name: idx_users_branch; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_branch ON public.users USING btree (branch);


--
-- Name: idx_users_department; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_department ON public.users USING btree (department);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_users_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_status ON public.users USING btree (status);


--
-- Name: idx_violations_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_violations_user ON public.violation_records USING btree (user_id, violation_date DESC);


--
-- Name: attendance_records trg_att_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_att_updated_at BEFORE UPDATE ON public.attendance_records FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: employee_breaks trg_eb_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_eb_updated_at BEFORE UPDATE ON public.employee_breaks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: leave_requests trg_leaves_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_leaves_updated_at BEFORE UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payslip_records trg_payroll_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_payroll_notify AFTER INSERT OR UPDATE ON public.payslip_records FOR EACH ROW EXECUTE FUNCTION public.notify_payroll_change();


--
-- Name: payslip_records trg_payslip_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_payslip_updated_at BEFORE UPDATE ON public.payslip_records FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: activity_logs activity_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: attendance_history attendance_history_original_attendance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_history
    ADD CONSTRAINT attendance_history_original_attendance_id_fkey FOREIGN KEY (original_attendance_id) REFERENCES public.attendance_records(id) ON DELETE SET NULL;


--
-- Name: attendance_records attendance_records_leave_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_leave_request_id_fkey FOREIGN KEY (leave_request_id) REFERENCES public.leave_requests(id) ON DELETE SET NULL;


--
-- Name: attendance_records attendance_records_logged_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_logged_by_user_id_fkey FOREIGN KEY (logged_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: attendance_records attendance_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: company_holidays company_holidays_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.company_holidays
    ADD CONSTRAINT company_holidays_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: dress_code_exemptions dress_code_exemptions_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dress_code_exemptions
    ADD CONSTRAINT dress_code_exemptions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: dress_code_exemptions dress_code_exemptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dress_code_exemptions
    ADD CONSTRAINT dress_code_exemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: employee_breaks employee_breaks_logged_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_breaks
    ADD CONSTRAINT employee_breaks_logged_by_user_id_fkey FOREIGN KEY (logged_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: employee_breaks employee_breaks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_breaks
    ADD CONSTRAINT employee_breaks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: employee_monthly_summary employee_monthly_summary_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_monthly_summary
    ADD CONSTRAINT employee_monthly_summary_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: leave_balance leave_balance_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leave_balance
    ADD CONSTRAINT leave_balance_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: leave_requests leave_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: leave_requests leave_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: offer_letter_actions offer_letter_actions_offer_letter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offer_letter_actions
    ADD CONSTRAINT offer_letter_actions_offer_letter_id_fkey FOREIGN KEY (offer_letter_id) REFERENCES public.offer_letters(id) ON DELETE CASCADE;


--
-- Name: offer_letter_audit_logs offer_letter_audit_logs_offer_letter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offer_letter_audit_logs
    ADD CONSTRAINT offer_letter_audit_logs_offer_letter_id_fkey FOREIGN KEY (offer_letter_id) REFERENCES public.offer_letters(id) ON DELETE CASCADE;


--
-- Name: payslip_records payslip_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payslip_records
    ADD CONSTRAINT payslip_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: phone_deposit_log phone_deposit_log_collected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.phone_deposit_log
    ADD CONSTRAINT phone_deposit_log_collected_by_fkey FOREIGN KEY (collected_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: phone_deposit_log phone_deposit_log_deposited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.phone_deposit_log
    ADD CONSTRAINT phone_deposit_log_deposited_by_fkey FOREIGN KEY (deposited_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: phone_deposit_log phone_deposit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.phone_deposit_log
    ADD CONSTRAINT phone_deposit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: violation_records violation_records_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.violation_records
    ADD CONSTRAINT violation_records_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: violation_records violation_records_related_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.violation_records
    ADD CONSTRAINT violation_records_related_user_id_fkey FOREIGN KEY (related_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: violation_records violation_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.violation_records
    ADD CONSTRAINT violation_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mv_monthly_attendance; Type: MATERIALIZED VIEW DATA; Schema: public; Owner: postgres
--

REFRESH MATERIALIZED VIEW public.mv_monthly_attendance;


--
-- Name: mv_payroll_monthly; Type: MATERIALIZED VIEW DATA; Schema: public; Owner: postgres
--

REFRESH MATERIALIZED VIEW public.mv_payroll_monthly;


--
-- PostgreSQL database dump complete
--

