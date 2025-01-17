/** @jsxRuntime classic */
/** @jsx jsx */

import { useState, Fragment, FormEvent, useRef, useEffect } from 'react';

import { jsx, H1, Stack, VisuallyHidden } from '@keystone-ui/core';
import { Button } from '@keystone-ui/button';
import { TextInput } from '@keystone-ui/fields';
import { Notice } from '@keystone-ui/notice';

import { useMutation, gql } from '@keystone-6/core/admin-ui/apollo';
import { useRawKeystone, useReinitContext } from '@keystone-6/core/admin-ui/context';
import { useRouter } from '@keystone-6/core/admin-ui/router';
import { SigninContainer } from '../components/SigninContainer';
import { useRedirect } from '../lib/useFromRedirect';

type SigninPageProps = {
  identityField: string;
  secretField: string;
  mutationName: string;
  successTypename: string;
  failureTypename: string;
};

export const getSigninPage = (props: SigninPageProps) => () => <SigninPage {...props} />;

export const SigninPage = ({
  identityField,
  secretField,
  mutationName,
  successTypename,
  failureTypename,
}: SigninPageProps) => {
  const mutation = gql`
    mutation($identity: String!, $secret: String!) {
      authenticate: ${mutationName}(${identityField}: $identity, ${secretField}: $secret) {
        ... on ${successTypename} {
          item {
            id
          }
        }
        ... on ${failureTypename} {
          message
        }
      }
    }
  `;

  const [mode, setMode] = useState<'signin' | 'forgot password'>('signin');
  const [state, setState] = useState({ identity: '', secret: '' });
  const [submitted, setSubmitted] = useState(false);

  const identityFieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    identityFieldRef.current?.focus();
  }, [mode]);

  const [mutate, { error, loading, data }] = useMutation(mutation);
  const reinitContext = useReinitContext();
  const router = useRouter();
  const rawKeystone = useRawKeystone();
  const redirect = useRedirect();

  // if we are signed in, redirect immediately
  useEffect(() => {
    if (submitted) return;
    if (rawKeystone.authenticatedItem.state === 'authenticated') {
      router.push(redirect);
    }
  }, [rawKeystone.authenticatedItem, router, redirect, submitted]);

  useEffect(() => {
    if (!submitted) return;

    // TODO: this is horrible, we need to resolve this mess
    // @ts-ignore
    if (rawKeystone.adminMeta?.error?.message === 'Access denied') {
      router.push('/no-access');
      return;
    }

    router.push(redirect);
  }, [rawKeystone.adminMeta, router, redirect, submitted]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (mode !== 'signin') return;

    try {
      const { data } = await mutate({
        variables: {
          identity: state.identity,
          secret: state.secret,
        },
      });
      if (data.authenticate?.__typename !== successTypename) return;
    } catch (e) {
      console.error(e);
      return;
    }

    await reinitContext();
    setSubmitted(true);
  };

  return (
    <SigninContainer title="Keystone - Sign in">
      <Stack gap="xlarge" as="form" onSubmit={onSubmit}>
        <H1>Sign In</H1>
        {error && (
          <Notice title="Error" tone="negative">
            {error.message}
          </Notice>
        )}
        {data?.authenticate?.__typename === failureTypename && (
          <Notice title="Error" tone="negative">
            {data?.authenticate.message}
          </Notice>
        )}
        <Stack gap="medium">
          <VisuallyHidden as="label" htmlFor="identity">
            {identityField}
          </VisuallyHidden>
          <TextInput
            id="identity"
            name="identity"
            value={state.identity}
            onChange={e => setState({ ...state, identity: e.target.value })}
            placeholder={identityField}
            ref={identityFieldRef}
          />
          {mode === 'signin' && (
            <Fragment>
              <VisuallyHidden as="label" htmlFor="password">
                {secretField}
              </VisuallyHidden>
              <TextInput
                id="password"
                name="password"
                value={state.secret}
                onChange={e => setState({ ...state, secret: e.target.value })}
                placeholder={secretField}
                type="password"
              />
            </Fragment>
          )}
        </Stack>

        {mode === 'forgot password' ? (
          <Stack gap="medium" across>
            <Button type="submit" weight="bold" tone="active">
              Log reset link
            </Button>
            <Button weight="none" tone="active" onClick={() => setMode('signin')}>
              Go back
            </Button>
          </Stack>
        ) : (
          <Stack gap="medium" across>
            <Button
              weight="bold"
              tone="active"
              isLoading={
                loading ||
                // this is for while the page is loading but the mutation has finished successfully
                data?.authenticate?.__typename === successTypename
              }
              type="submit"
            >
              Sign in
            </Button>
            {/* Disabled until we come up with a complete password reset workflow */}
            {/* <Button weight="none" tone="active" onClick={() => setMode('forgot password')}>
              Forgot your password?
            </Button> */}
          </Stack>
        )}
      </Stack>
    </SigninContainer>
  );
};
