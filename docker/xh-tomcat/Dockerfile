FROM tomcat:8.5

# Clean up standard bundled webapps
RUN cd webapps && \
  rm -rf ROOT* && \
  rm -rf docs && \
  rm -rf examples && \
  rm -rf manager && \
  rm -rf host-manager

# Copy in setenv for environment variable support
COPY setenv.sh bin/

# Install some useful basic utilities
RUN apt-get update && apt-get install -y nano vim procps htop dnsutils