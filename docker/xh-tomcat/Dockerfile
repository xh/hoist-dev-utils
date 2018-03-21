FROM tomcat:8.5

# Clean up standard bundled webapps
RUN cd webapps && \
  rm -rf ROOT* && \
  rm -rf docs && \
  rm -rf examples && \
  rm -rf manager && \
  rm -rf host-manager

# Set standard Java Opts with elevated memory allocation
ENV JAVA_OPTS="$JAVA_OPTS -Xmx4g"
